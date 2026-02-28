# Smoke Test Phase 1–3
Generated: 2026-02-28T05:51:06.333Z
API Base: http://localhost:3000

| Step | Result | Status | Notes |
| --- | --- | --- | --- |
| Admin login | PASS | 200 |  |
| Admin partner login | PASS | 200 |  |
| Admin leads baseline before artist request | PASS | 200 |  |
| Admin probe allowed | PASS | 200 |  |
| Buyer login | PASS | 200 |  |
| Buyer partner login rejected | PASS | 401 |  |
| Register smoke requester | PASS | 200 |  |
| Requestor submits artist request | PASS | 201 |  |
| Artist request does not create lead | PASS | 200 | lead count unchanged (27) |
| Buyer probe forbidden (403) | PASS | 403 |  |
| Label login | PASS | 200 |  |
| Label partner login | PASS | 200 |  |
| Dashboards meta | PASS | 200 |  |
| Label read allowed | PASS | 200 |  |
| Label mutate forbidden (403) | PASS | 403 |  |
| Admin create artist | PASS | 409 | handle already exists |
| Artist page loads | PASS | 200 |  |
| Artist shelf loads | PASS | 200 |  |
| Admin create label | PASS | 409 | handle already exists |
| Link label to artist | PASS | 200 |  |
| Label sales probe allowed | PASS | 200 |  |
| Label sales probe forbidden (403) | PASS | 403 |  |
| Link artist user to artist | PASS | 200 |  |
| Buyer cannot create product | PASS | 403 |  |
| Artist login | PASS | 200 |  |
| Artist partner login | PASS | 200 |  |
| Artist cannot create product | PASS | 403 |  |
| Admin creates product | PASS | 201 |  |
| Admin manages variants | PASS | 200 |  |
| Artist seeded drop has products in list | PASS | 200 |  |
| Artist publishes seeded drop successfully | PASS | 200 |  |
| Artist cannot edit product fields | PASS | 403 |  |
| Artist can toggle product status | PASS | 200 |  |
| Artist cannot manage variants | PASS | 403 |  |
| Buyer views products | PASS | 200 |  |
| Buyer views product detail | PASS | 200 |  |
| Concurrent orders prevent oversell | PASS | 200 | success=200 failure=400 stock=0 |
| Buyer creates order | PASS | 200 |  |
| Buyer order detail shows unpaid payment | PASS | 200 |  |
| Buyer lists my orders | PASS | 200 |  |
| Buyer gets order detail | PASS | 200 |  |
| Buyer cancels order | PASS | 200 |  |
| Buyer order events include cancelled | PASS | 200 |  |
| Buyer cannot cancel twice | PASS | 400 |  |
| Buyer reorders after cancel | PASS | 200 |  |
| Admin lists orders | PASS | 200 |  |
| Admin gets order detail | PASS | 200 |  |
| Buyer pays order | PASS | 200 |  |
| Confirm payment attempt | PASS | 200 |  |
| Payment confirm is idempotent | PASS | 200 |  |
| Buyer order detail shows paid payment | PASS | 200 |  |
| Admin fulfills order | PASS | 200 |  |
| Admin refunds order | PASS | 200 |  |
| Buyer order detail shows refunded payment | PASS | 200 |  |
| Buyer creates unpaid order | PASS | 200 |  |
| Admin cannot fulfill unpaid order | PASS | 400 |  |
| Admin order events include paid/fulfilled/refunded | PASS | 200 |  |
| Admin dashboard summary | PASS | 200 |  |
| Buyer cannot access admin dashboard summary | PASS | 403 |  |
| Artist cannot access admin dashboard summary | PASS | 403 |  |
| Label cannot access admin dashboard summary | PASS | 403 |  |
| Buyer order events include paid/fulfilled/refunded | PASS | 200 |  |
| Artist dashboard summary | PASS | 200 |  |
| Buyer cannot access artist summary | PASS | 403 |  |
| Label cannot access artist summary | PASS | 403 |  |
| Admin cannot access artist summary | PASS | 403 |  |
| Artist dashboard orders | PASS | 200 |  |
| Buyer cannot access artist orders | PASS | 403 |  |
| Label cannot access artist orders | PASS | 403 |  |
| Admin cannot access artist orders | PASS | 403 |  |
| Admin leads alias parity (status + shape) | PASS | 200 | canonical=200, alias=200 |
| Buyer cannot access admin dashboard summary | PASS | 403 |  |
| Artist cannot access admin dashboard summary | PASS | 403 |  |
| Label cannot access admin dashboard summary | PASS | 403 |  |
| Admin dashboard orders | PASS | 200 |  |
| Buyer cannot access admin dashboard orders | PASS | 403 |  |
| Artist cannot access admin dashboard orders | PASS | 403 |  |
| Label cannot access admin dashboard orders | PASS | 403 |  |
| Buyer cannot cancel fulfilled order | PASS | 400 |  |
| Label dashboard summary | PASS | 200 |  |
| Label dashboard summary alias (/api/label) | PASS | 200 |  |
| Label summary alias parity (status + shape) | PASS | 200 |  |
| Label artist detail summary | PASS | 200 |  |
| Label artist detail summary alias (/api/label) | PASS | 200 |  |
| Label artist detail unmapped forbidden | PASS | 403 |  |
| Buyer cannot access label summary | PASS | 403 |  |
| Artist cannot access label summary | PASS | 403 |  |
| Admin cannot access label summary | PASS | 403 |  |
| Label dashboard orders | PASS | 200 |  |
| Admin finds pending artist request | PASS | 200 |  |
| Admin approves artist request | PASS | 200 |  |
| Requestor re-login after approval | PASS | 200 |  |
| Buyer cannot access label orders | PASS | 403 |  |
| Artist cannot access label orders | PASS | 403 |  |
| Admin cannot access label orders | PASS | 403 |  |
| Artist cannot list orders | PASS | 403 |  |
| Admin creates artist drop draft | PASS | 201 |  |
| Artist scoped drops list includes own drop | PASS | 200 |  |
| Artist cannot create drop via artist scope | PASS | 403 |  |
| Buyer cannot see draft drop | PASS | 404 |  |
| Admin attaches product to drop | PASS | 200 |  |
| Artist cannot attach product in artist scope | PASS | 403 |  |
| Admin creates foreign artist drop | PASS | 201 |  |
| Artist cannot publish foreign drop (403) | PASS | 403 |  |
| Artist cannot unpublish foreign drop (403) | PASS | 403 |  |
| Buyer order events include placed | PASS | 200 |  |
| Artist publishes own drop via artist scope | PASS | 200 |  |
| Buyer views published drop | PASS | 200 |  |
| Buyer views drop products | PASS | 200 |  |
| Buyer sees featured drops | PASS | 200 |  |
| Artist unpublishes own drop via artist scope | PASS | 200 |  |
| Buyer cannot see draft drop | PASS | 404 |  |
| Admin archives drop | PASS | 200 |  |
| Buyer cannot see archived drop | PASS | 404 |  |
| Buyer sees featured drops without archived | PASS | 200 |  |
