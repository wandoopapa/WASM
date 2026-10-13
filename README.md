# WASM 게이트웨이 — 가족앱 채팅 (외부 1회성 접속)

외부(테일넷 없는) PC에서 사용자 본인이 1회성으로 가족앱 채팅방에 접속하는 정적 페이지.
브라우저 탭이 Tailscale WASM ephemeral 노드가 되어 테일넷에 입장한다 (탭 종료 시 노드 소멸).

- **비밀정보 없음** — 이 저장소에는 키·토큰이 없다. 보안 단일 관문 = 테일스케일 계정 로그인.
- 대상: 가족앱 개발앱 (`https://steamdeck.tail8cdc35.ts.net:8446` → `:8010`)

## 파일

| 파일 | 설명 |
|---|---|
| `index.html` | 게이트웨이 UI (로딩·로그인·간이 채팅) |
| `app.js` | WASM 부팅·로그인·채팅 API 호출 |
| `gw.wasm` | Tailscale IPN WASM 포크 (`tailscale.com@v1.104.1` `cmd/tsconnect/wasm` + `fetch` POST 확장 + 공개 CA 번들 임베드) |
| `wasm_exec.js` | Go WASM 런타임 (Go 1.27) |

## 빌드 (스팀덱)

```sh
cd /home/deck/src/wasm-gw
GOOS=js GOARCH=wasm go build -ldflags='-s -w' -o gw.wasm .
cp $(go env GOROOT)/lib/wasm/wasm_exec.js dist/
cp gw.wasm dist/
```

## GitHub Pages

저장소 Settings → Pages → Deploy from branch → `main` / `/(root)`.
