import pytest
from fastapi import HTTPException

from app.api.v1.routers.coding import parse_generated_files
from app.api.v1.routers.plugins import validate_manifest, validate_public_https_url


def test_code_response_requires_valid_project_files():
    summary, files = parse_generated_files(
        '{"summary":"One file","files":[{"path":"src/main.py","language":"python","content":"print(1)"}]}'
    )

    assert summary == "One file"
    assert files[0]["path"] == "src/main.py"


@pytest.mark.parametrize("path", ["../outside.py", "/etc/passwd", "src/%2e%2e/secrets.txt"])
def test_code_response_rejects_unsafe_paths(path):
    payload = (
        '{"summary":"bad","files":[{"path":"'
        + path
        + '","language":"text","content":"no"}]}'
    )

    with pytest.raises(ValueError):
        parse_generated_files(payload)


def test_plugin_manifest_requires_unique_named_safe_actions():
    valid = validate_manifest(
        {"actions": [{"name": "get_status", "method": "GET", "path": "/v1/status"}]}
    )
    assert valid["actions"][0]["name"] == "get_status"

    with pytest.raises(HTTPException):
        validate_manifest(
            {"actions": [{"name": "escape", "method": "GET", "path": "/../../admin"}]}
        )


@pytest.mark.asyncio
async def test_plugin_urls_must_use_https_and_reject_private_hosts():
    with pytest.raises(HTTPException):
        await validate_public_https_url("http://example.com/api")
