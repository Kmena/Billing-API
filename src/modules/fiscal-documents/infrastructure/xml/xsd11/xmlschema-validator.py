#!/usr/bin/env python3
"""Offline XML Schema 1.1 validator for pinned Hacienda schemas.

This helper is an infrastructure detail invoked by Xsd11ValidatorAdapter.
It intentionally accepts only local file paths and emits bounded JSON output.
"""

from __future__ import annotations

import json
import sys
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any

try:
    import xmlschema
except ImportError as import_error:
    xmlschema = None
    XMLSCHEMA_IMPORT_ERROR = import_error
else:
    XMLSCHEMA_IMPORT_ERROR = None

MAX_MESSAGE_LENGTH = 300
MAX_ERRORS = 20
FIVE_PLACES = Decimal("0.00001")


def sanitize(message: str) -> str:
    normalized = " ".join(message.replace("\r", " ").replace("\n", " ").replace("\t", " ").split())
    if "<" in normalized and ">" in normalized:
        normalized = normalized.replace("<", "&lt;").replace(">", "&gt;")
    return normalized[:MAX_MESSAGE_LENGTH]


def emit(payload: dict[str, Any], exit_code: int) -> None:
    print(json.dumps(payload, ensure_ascii=False))
    raise SystemExit(exit_code)


def assert_local_file(raw_path: str, label: str) -> Path:
    path = Path(raw_path).resolve()
    if not path.is_file():
        emit(
            {
                "valid": False,
                "engine": engine_metadata(),
                "errors": [
                    {
                        "code": "FISCAL_XML_LOCAL_FILE_REQUIRED",
                        "message": f"{label} must be an existing local file.",
                    }
                ],
            },
            2,
        )
    return path


def engine_metadata() -> dict[str, str]:
    return {
        "name": "python-xmlschema",
        "version": getattr(xmlschema, "__version__", "unavailable"),
        "schemaVersion": "XML Schema 1.1",
    }


def assert_engine_available() -> None:
    if XMLSCHEMA_IMPORT_ERROR is None:
        return
    emit(
        {
            "valid": False,
            "engine": engine_metadata(),
            "errors": [
                {
                    "code": "FISCAL_XML_VALIDATOR_CONFIGURATION_INVALID",
                    "message": "Python dependency xmlschema is not installed.",
                }
            ],
        },
        2,
    )


def compile_schema(schema_path: Path):
    assert_engine_available()
    return xmlschema.XMLSchema11(str(schema_path), allow="local", defuse="always")


def compile_command(schema_path: Path) -> None:
    compile_schema(schema_path)
    emit({"valid": True, "engine": engine_metadata(), "errors": []}, 0)


def fiscal_amount_errors(root) -> list[dict[str, str]]:
    """Independent arithmetic check after structural XSD validation, before signing."""
    namespace = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
    def node(parent, path):
        return parent.find("/".join(namespace + segment for segment in path.split("/")))
    def amount(parent, path):
        found = node(parent, path)
        return Decimal(found.text) if found is not None and found.text else Decimal(0)
    def mismatch(label):
        return {"code": "FISCAL_XML_PRE_SIGN_AMOUNT_MISMATCH", "message": label + " does not reconcile."}

    gross_sum = Decimal(0)
    discount_sum = Decimal(0)
    subtotal_sum = Decimal(0)
    tax_sum = Decimal(0)
    line_total_sum = Decimal(0)
    for detail in root.findall("/".join((namespace + "DetalleServicio", namespace + "LineaDetalle"))):
        if len(detail.findall(namespace + "Impuesto")) != 1:
            return [mismatch("Line tax count")]
        gross = amount(detail, "MontoTotal")
        discount = sum((amount(item, "MontoDescuento") for item in detail.findall(namespace + "Descuento")), Decimal(0))
        subtotal = amount(detail, "SubTotal")
        base = amount(detail, "BaseImponible")
        tax_node = node(detail, "Impuesto")
        tax = amount(tax_node, "Monto") if tax_node is not None else Decimal(0)
        assumed = amount(detail, "ImpuestoAsumidoEmisorFabrica")
        net = amount(detail, "ImpuestoNeto")
        line_total = amount(detail, "MontoTotalLinea")
        expected_gross = (amount(detail, "Cantidad") * amount(detail, "PrecioUnitario")).quantize(
            FIVE_PLACES, rounding=ROUND_HALF_UP)
        if gross != expected_gross or subtotal != gross - discount:
            return [mismatch("Line gross/subtotal")]
        if tax_node is not None and amount(tax_node, "Codigo") == Decimal(1) and base != subtotal:
            return [mismatch("BaseImponible")]
        if net != tax - assumed or line_total != subtotal + net:
            return [mismatch("Line net tax/total")]
        gross_sum += gross
        discount_sum += discount
        subtotal_sum += subtotal
        tax_sum += net
        line_total_sum += line_total

    summary = node(root, "ResumenFactura")
    if summary is None:
        return [mismatch("ResumenFactura")]
    if (amount(summary, "TotalVenta") != gross_sum or
        amount(summary, "TotalDescuentos") != discount_sum or
        amount(summary, "TotalVentaNeta") != subtotal_sum or
        amount(summary, "TotalImpuesto") != tax_sum or
        amount(summary, "TotalComprobante") != line_total_sum):
        return [mismatch("ResumenFactura totals")]
    return []


def validate_command(schema_path: Path, xml_path: Path, unsigned_structure: bool = False) -> None:
    schema = compile_schema(schema_path)
    xml_resource = xmlschema.XMLResource(str(xml_path), allow="local", defuse="always")
    if unsigned_structure and any(
        element.tag == "{http://www.w3.org/2000/09/xmldsig#}Signature"
        for element in xml_resource.root.iter()
    ):
        emit({"valid": False, "engine": engine_metadata(), "errors": [{
            "code": "FISCAL_XML_UNSIGNED_PAYLOAD_CONTAINS_SIGNATURE",
            "message": "Pre-sign validation requires an unsigned XML document.",
        }]}, 1)
    errors = []
    signature_errors = 0
    for error in schema.iter_errors(xml_resource):
        reason = getattr(error, "reason", None) or str(error)
        if unsigned_structure and (
            getattr(error, "path", "") in (
                "/FacturaElectronica", "/TiqueteElectronico",
                "/NotaCreditoElectronica", "/NotaDebitoElectronica",
            )
            and "Tag 'ds:Signature' expected." in reason
        ):
            signature_errors += 1
            continue
        errors.append(
            {
                "code": "FISCAL_XML_VALIDATION_FAILED",
                "message": sanitize(reason),
                "line": getattr(error, "sourceline", None),
                "column": None,
            }
        )
        if len(errors) >= MAX_ERRORS:
            break
    if unsigned_structure and signature_errors != 1:
        errors.append({
            "code": "FISCAL_XML_PRE_SIGN_SIGNATURE_EXPECTATION_FAILED",
            "message": "Official v4.4 XSD must report exactly one missing root signature.",
        })
    if unsigned_structure and not errors:
        try:
            errors.extend(fiscal_amount_errors(xml_resource.root))
        except (ValueError, ArithmeticError, AttributeError, TypeError):
            errors.append({
                "code": "FISCAL_XML_PRE_SIGN_AMOUNT_MISMATCH",
                "message": "Fiscal amounts could not be reconciled.",
            })
    if errors:
        emit({"valid": False, "engine": engine_metadata(), "errors": errors}, 1)
    emit({"valid": True, "engine": engine_metadata(), "errors": []}, 0)


def main() -> None:
    if len(sys.argv) not in (3, 4) or sys.argv[1] not in ("compile", "validate", "validate-unsigned"):
        emit(
            {
                "valid": False,
                "engine": engine_metadata(),
                "errors": [
                    {
                        "code": "FISCAL_XML_VALIDATOR_USAGE_ERROR",
                        "message": "Usage: xmlschema-validator.py compile <schema> | validate[ -unsigned] <schema> <xml>",
                    }
                ],
            },
            2,
        )

    command = sys.argv[1]
    schema_path = assert_local_file(sys.argv[2], "schema")
    try:
        if command == "compile":
            compile_command(schema_path)
        else:
            xml_path = assert_local_file(sys.argv[3], "xml")
            validate_command(schema_path, xml_path, command == "validate-unsigned")
    except Exception as error:
        if xmlschema is not None and isinstance(error, xmlschema.XMLSchemaException):
            emit(
                {
                    "valid": False,
                    "engine": engine_metadata(),
                    "errors": [
                        {
                            "code": "FISCAL_XML_VALIDATION_FAILED",
                            "message": sanitize(str(error)),
                        }
                    ],
                },
                1,
            )
        emit(
            {
                "valid": False,
                "engine": engine_metadata(),
                "errors": [
                    {
                        "code": "FISCAL_XML_VALIDATOR_FAILED",
                        "message": "XML validation failed.",
                    }
                ],
            },
            1,
        )


if __name__ == "__main__":
    main()
