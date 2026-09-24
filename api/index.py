from urllib.parse import parse_qsl, unquote, urlencode

from backend.app.main import app as fastapi_app


async def app(scope, receive, send):
    if scope["type"] != "http":
        await fastapi_app(scope, receive, send)
        return

    query_items = parse_qsl(scope.get("query_string", b"").decode(), keep_blank_values=True)
    forwarded_path = next((value for key, value in query_items if key == "path"), None)
    if forwarded_path:
        scope = {
            **scope,
            "path": unquote(forwarded_path),
            "query_string": urlencode(
                [(key, value) for key, value in query_items if key != "path"]
            ).encode(),
        }
    await fastapi_app(scope, receive, send)


__all__ = ["app"]
