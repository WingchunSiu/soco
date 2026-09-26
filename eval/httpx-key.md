# HTTPX redirect source-reading key (written before root runs)

Public source: encode/httpx tag 0.28.1, commit 26d48e0634e6ee9cdc0533996db289ce4b430177. Only httpx/ is provided to the agent. Tests and this key are excluded.

Required facts: POST becomes GET for 301, 302, 303; 307 preserves POST and stream. For a switch to GET, Content-Length and Transfer-Encoding are removed, stream becomes None. Content-Type is not explicitly removed in this helper. Cross-origin strips Authorization except same-host http default port 80 to https default port 443 (including explicit default ports). Non-default port upgrades do not qualify. Same origin retains Authorization. Cross-origin Host becomes target netloc. Cookie is always removed from copied headers; redirect Request receives a copy of the client's cookie jar. Merely removing the raw header does not mean the next request has no cookies.

Evidence: _client.py:61-91,475-515,546-583. Request cookie application in _models.py. Score as source-grounded partial/full correctness, not just matching strings.

Prediction: this is a direct-lookup control. Ordinary search plus targeted reads should suffice; Jev may be unnecessary and add cost. No assumption of benchmark novelty or absence from the root model's training data.
