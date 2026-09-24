from urllib.parse import parse_qsl, unquote, urlencode

from backend.app.main import app as fastapi_app


async def app(scope, receive, send):
    if scope["type"] != "http":
        await fastapi_app(scope, receive, send)
        return

    query_items = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
    forwarded_path = next((value for key, value in query_items if key == "path"), None)
    request_path = unquote(forwarded_path) if forwarded_path else scope["path"]
    if request_path == "/api":
        request_path = "/"
    elif request_path.startswith("/api/"):
        request_path = request_path[4:]
    if request_path != scope["path"]:
        scope = {
            **scope,
            "path": request_path,
            "query_string": urlencode(
                [(key, value) for key, value in query_items if key != "path"]
            ).encode(),
        }
    await fastapi_app(scope, receive, send)


__all__ = ["app"]
