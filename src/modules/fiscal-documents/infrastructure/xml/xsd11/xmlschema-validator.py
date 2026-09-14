#!/usr/bin/env python3
"""Offline XML Schema 1.1 validator for pinned Hacienda schemas.

This helper is an infrastructure detail invoked by Xsd11ValidatorAdapter.
It intentionally accepts only local file paths and emits bounded JSON output.
"""

from __future__ import annotations

import json
import sys
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


def validate_command(schema_path: Path, xml_path: Path) -> None:
    schema = compile_schema(schema_path)
    xml_resource = xmlschema.XMLResource(str(xml_path), allow="local", defuse="always")
    errors = []
    for error in schema.iter_errors(xml_resource):
        errors.append(
            {
                "code": "FISCAL_XML_VALIDATION_FAILED",
                "message": sanitize(getattr(error, "reason", None) or str(error)),
                "line": getattr(error, "sourceline", None),
                "column": None,
            }
        )
        if len(errors) >= MAX_ERRORS:
            break
    if errors:
        emit({"valid": False, "engine": engine_metadata(), "errors": errors}, 1)
    emit({"valid": True, "engine": engine_metadata(), "errors": []}, 0)


def main() -> None:
    if len(sys.argv) not in (3, 4) or sys.argv[1] not in ("compile", "validate"):
        emit(
            {
                "valid": False,
                "engine": engine_metadata(),
                "errors": [
                    {
                        "code": "FISCAL_XML_VALIDATOR_USAGE_ERROR",
                        "message": "Usage: xmlschema-validator.py compile <schema> | validate <schema> <xml>",
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
            validate_command(schema_path, xml_path)
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
