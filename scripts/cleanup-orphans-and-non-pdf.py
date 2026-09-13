#!/usr/bin/env python3
"""Delete orphan UPLOADED PDFs (no S3 object) and all non-PDF test documents."""

from __future__ import annotations

import json
import subprocess
import urllib.request

API = "https://fyxx7fo395.execute-api.us-east-1.amazonaws.com"
BUCKET = "ocrstack-docsbucketecea003f-s3ztmhmm7j2j"
TABLE = "OcrStack-OcrTable108CDB79-FIK5GWEZFEMQ"


def api_get(path: str):
    with urllib.request.urlopen(API + path) as response:
        return json.load(response, strict=False)


def run_aws(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["aws", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def aws_json(args: list[str]):
    result = run_aws([*args, "--output", "json"])
    if result.returncode != 0:
        return None
    if not result.stdout.strip():
        return None
    return json.loads(result.stdout)


def delete_s3(key: str) -> bool:
    head = run_aws(["s3api", "head-object", "--bucket", BUCKET, "--key", key])
    if head.returncode != 0:
        return False
    run_aws(["s3api", "delete-object", "--bucket", BUCKET, "--key", key])
    return True


def query_pk(pk: str) -> list[dict]:
    items: list[dict] = []
    start_key = None
    while True:
        args = [
            "dynamodb",
            "query",
            "--table-name",
            TABLE,
            "--key-condition-expression",
            "PK = :pk",
            "--expression-attribute-values",
            json.dumps({":pk": {"S": pk}}),
        ]
        if start_key:
            args.extend(["--exclusive-start-key", json.dumps(start_key)])
        data = aws_json(args)
        if not data:
            break
        items.extend(data.get("Items", []))
        start_key = data.get("LastEvaluatedKey")
        if not start_key:
            break
    return items


def delete_item(pk: str, sk: str) -> None:
    run_aws(
        [
            "dynamodb",
            "delete-item",
            "--table-name",
            TABLE,
            "--key",
            json.dumps({"PK": {"S": pk}, "SK": {"S": sk}}),
        ]
    )


def scan_entity(entity_type: str) -> list[dict]:
    items: list[dict] = []
    start_key = None
    while True:
        args = [
            "dynamodb",
            "scan",
            "--table-name",
            TABLE,
            "--filter-expression",
            "entityType = :e",
            "--expression-attribute-values",
            json.dumps({":e": {"S": entity_type}}),
            "--projection-expression",
            "PK,SK,documentId",
        ]
        if start_key:
            args.extend(["--exclusive-start-key", json.dumps(start_key)])
        data = aws_json(args)
        if not data:
            break
        items.extend(data.get("Items", []))
        start_key = data.get("LastEvaluatedKey")
        if not start_key:
            break
    return items


def delete_document(meta: dict) -> dict:
    document_id = meta["documentId"]
    created_at = meta["createdAt"]
    status = meta["status"]
    s3_key = meta["s3Key"]
    deleted = {"docItems": 0, "s3": False}

    if delete_s3(s3_key):
        deleted["s3"] = True

    for item in query_pk(f"DOC#{document_id}"):
        delete_item(item["PK"]["S"], item["SK"]["S"])
        deleted["docItems"] += 1

    delete_item("DOCS", f"TS#{created_at}#DOC#{document_id}")
    for state in ["UPLOADED", "QUEUED", "PROCESSING", "COMPLETED", "FAILED"]:
        delete_item(f"STATUS#{state}", f"TS#{created_at}#DOC#{document_id}")

    dates = {
        created_at[:10],
        (meta.get("completedAt") or created_at)[:10],
        (meta.get("updatedAt") or created_at)[:10],
    }
    for kind in ["survey_kap", "invoice", "receipt", "generic"]:
        for day in dates:
            delete_item(f"KIND#{kind}", f"DATE#{day}#DOC#{document_id}")

    return deleted


def main() -> None:
    docs = api_get("/documents?limit=100")["items"]
    targets: list[tuple[str, dict]] = []

    for doc in docs:
        detail = api_get(f"/documents/{doc['documentId']}")
        meta = detail["meta"]
        is_pdf = meta["contentType"] == "application/pdf" or (
            meta["filename"] or ""
        ).lower().endswith(".pdf")

        if not is_pdf:
            targets.append(("non_pdf_test", meta))
            continue

        if meta["status"] == "UPLOADED":
            head = run_aws(
                ["s3api", "head-object", "--bucket", BUCKET, "--key", meta["s3Key"]]
            )
            if head.returncode != 0:
                targets.append(("orphan_pdf", meta))

    print(f"Targets to delete: {len(targets)}")
    for reason, meta in targets:
        print(
            f"  [{reason}] {meta['status']:10} {meta['filename']} "
            f"({meta['contentType']}) id={meta['documentId']}"
        )

    target_ids = {meta["documentId"] for _, meta in targets}

    textract_deleted = 0
    for item in scan_entity("TEXTRACT_JOB_LINK"):
        doc_id = item.get("documentId", {}).get("S")
        if doc_id in target_ids:
            delete_item(item["PK"]["S"], item["SK"]["S"])
            textract_deleted += 1

    field_deleted = 0
    for item in scan_entity("ANALYTICS_FIELD_ITEM"):
        doc_id = item.get("documentId", {}).get("S")
        if doc_id in target_ids:
            delete_item(item["PK"]["S"], item["SK"]["S"])
            field_deleted += 1

    kind_deleted = 0
    for item in scan_entity("ANALYTICS_KIND_ITEM"):
        doc_id = item.get("documentId", {}).get("S")
        if doc_id in target_ids:
            delete_item(item["PK"]["S"], item["SK"]["S"])
            kind_deleted += 1

    print(f"\nDeleted TEXTRACT links: {textract_deleted}")
    print(f"Deleted FIELD items: {field_deleted}")
    print(f"Deleted KIND items: {kind_deleted}")

    summary = {"orphan_pdf": 0, "non_pdf_test": 0, "s3": 0, "docItems": 0}
    for reason, meta in targets:
        result = delete_document(meta)
        summary[reason] += 1
        summary["docItems"] += result["docItems"]
        if result["s3"]:
            summary["s3"] += 1
        print(
            f"deleted {reason}: {meta['filename']} "
            f"docItems={result['docItems']} s3={result['s3']}"
        )

    print("\n=== CLEANUP SUMMARY ===")
    print(json.dumps(summary, indent=2))

    remaining = api_get("/documents?limit=100")["items"]
    print(f"\nRemaining documents: {len(remaining)}")
    for doc in remaining:
        print(f"  {doc['status']:10} {doc['filename']} {doc['contentType']}")


if __name__ == "__main__":
    main()
