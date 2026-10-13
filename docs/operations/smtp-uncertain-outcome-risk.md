# SMTP Uncertain External Outcome — Risk Acceptance Record

Status: technically characterized; business/operations acceptance is **PENDING**. This document does not accept the risk on behalf of an owner.

## Description

SMTP does not provide Billing with a universal idempotency key or atomic transaction shared with PostgreSQL. The SMTP server may accept `DATA` and then lose the acknowledgement. Billing cannot determine from the disconnected client session whether the recipient delivery was accepted.

## Occurrence and impact

A timeout, reset, worker crash, database outage, or lease expiry after SMTP acceptance but before durable acknowledgement can leave an externally accepted message with a local uncertain result. Blind retry could deliver a duplicate fiscal email; marking it delivered without proof could hide a failed delivery.

## Implemented mitigation

- Delivery intent and attempts are persisted before external submission.
- Proven pre-session failures may use bounded retry.
- Timeout/reset after a session can no longer be proven safe and is classified `SMTP_ACCEPTANCE_UNKNOWN`.
- `UNKNOWN_EXTERNAL_OUTCOME` and stale `SENDING` move to `MANUAL_REVIEW_REQUIRED` without automatic resend.
- `DELIVERED` never regresses and stale jobs are no-ops.
- Artifacts are hash-verified and tenant/company scoped.
- A controlled local SMTP server proved normal acceptance and loss of the post-`DATA` acknowledgement without sending real email.

## Manual recovery

1. Stop automatic action for the delivery and preserve the attempt/audit evidence.
2. Query the provider using message ID, server logs, or provider reconciliation tooling when available.
3. If acceptance is proven, record the provider evidence and close as delivered through the approved operator command/process.
4. If non-acceptance is proven, authorize a new attempt with a new audit event.
5. If the outcome remains unknown, retain manual review; any resend requires an explicit human decision acknowledging duplicate risk.

## Residual risk and owner

Residual risk: duplicate or missing recipient delivery when provider acceptance cannot be reconciled. Fiscal document status, identity, sequence, and artifacts remain unchanged. Required acceptance owner: Billing operations plus fiscal/business owner. Acceptance status: **NOT ACCEPTED / PENDING HUMAN APPROVAL**.