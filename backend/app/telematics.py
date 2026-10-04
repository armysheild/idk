import ipaddress
import socket
from urllib.parse import urlsplit

import httpx

from .config import Settings


def validate_provider_url(base_url: str, sync_path: str) -> str:
    parsed = urlsplit(base_url)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port not in (None, 443)
        or parsed.query
        or parsed.fragment
        or not sync_path.startswith("/")
        or sync_path.startswith("//")
        or "\\" in base_url + sync_path
    ):
        raise ValueError("Use an HTTPS provider URL and a relative sync path")
    return f"{base_url.rstrip('/')}/{sync_path.lstrip('/')}"


def approved_provider_request(provider: str, base_url: str, sync_path: str, settings: Settings) -> httpx.Request:
    url = httpx.URL(validate_provider_url(base_url, sync_path))
    host = url.raw_host.decode("ascii")
    allowed_hosts = settings.telematics_provider_hosts.get(provider, [])
    if host not in {item.lower() for item in allowed_hosts}:
        raise ValueError("Provider host is not approved in server configuration")
    try:
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as error:
        raise ValueError("Provider host cannot be resolved") from error
    if not addresses or any(not ipaddress.ip_address(address[4][0]).is_global for address in addresses):
        raise ValueError("Provider host must resolve only to public addresses")
    return httpx.Request(
        "GET",
        url.copy_with(host=addresses[0][4][0]),
        headers={"Host": url.netloc.decode("ascii")},
        extensions={"sni_hostname": host},
    )
