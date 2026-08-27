"""OpenAPI spec → MCP tool definitions converter.

Eden-MCP-Proxy 패턴 참조: operation 1개 = MCP tool 1개.
path params + query params + requestBody → inputSchema.
"""
import re


def openapi_to_mcp_tools(spec: dict, path_prefix_filter: str | None = None) -> list[dict]:
    """Active addon prefix 기준으로 OpenAPI paths → MCP tool list."""
    tools = []
    paths = spec.get("paths", {})
    components = spec.get("components", {})

    for path, path_item in paths.items():
        if path_prefix_filter and not path.startswith(path_prefix_filter):
            continue
        if not isinstance(path_item, dict):
            continue

        for http_method in ("get", "post", "put", "patch", "delete"):
            op = path_item.get(http_method)
            if not op:
                continue

            op_id = op.get("operationId") or f"{http_method}_{path}"
            tool_name = re.sub(r"[^a-zA-Z0-9_]", "_", op_id).strip("_")
            tool_name = re.sub(r"_+", "_", tool_name)

            properties: dict = {}
            required: list[str] = []

            for param in op.get("parameters", []):
                if not isinstance(param, dict):
                    continue
                name = param.get("name", "")
                if not name:
                    continue
                schema = dict(param.get("schema") or {"type": "string"})
                desc = param.get("description", "")
                if desc:
                    schema["description"] = desc
                schema["x-param-in"] = param.get("in", "query")
                properties[name] = schema
                if param.get("required"):
                    required.append(name)

            req_body = op.get("requestBody", {})
            if req_body:
                json_schema = (
                    req_body.get("content", {})
                    .get("application/json", {})
                    .get("schema", {})
                )
                json_schema = _resolve_ref(json_schema, components)
                for prop_name, prop_schema in json_schema.get("properties", {}).items():
                    properties[prop_name] = _resolve_ref(prop_schema, components)
                required.extend(json_schema.get("required", []))

            tools.append({
                "name": tool_name,
                "description": op.get("summary") or op.get("description") or f"{http_method.upper()} {path}",
                "inputSchema": {
                    "type": "object",
                    "properties": properties,
                    "required": list(dict.fromkeys(required)),
                },
                "_meta": {"method": http_method.upper(), "path": path},
            })

    return tools


def _resolve_ref(schema: dict, components: dict) -> dict:
    """Local $ref 해석 (#/components/schemas/...)."""
    if not isinstance(schema, dict):
        return schema
    ref = schema.get("$ref", "")
    if not ref.startswith("#/"):
        return schema
    parts = ref[2:].split("/")
    cur: dict = {"components": components}
    try:
        for part in parts:
            cur = cur[part]  # type: ignore[assignment]
        return cur
    except (KeyError, TypeError):
        return schema
