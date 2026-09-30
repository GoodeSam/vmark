# 개인 정보 보호

VMark는 여러분의 개인 정보를 존중합니다. 실제로 일어나는 일 — 그리고 일어나지 않는 일을 정확히 설명합니다.

## VMark가 전송하는 것

VMark에는 새 버전이 사용 가능한지 확인하기 위해 주기적으로 서버에 접속하는 **자동 업데이트 확인기** 가 포함되어 있습니다. 이것이 VMark가 수행하는 **유일한** 네트워크 요청입니다.

각 확인은 정확히 다음 필드만 전송합니다 — 그 이상은 없습니다:

| 데이터 | 예시 | 목적 |
|--------|------|------|
| IP 주소 | `203.0.113.42` | HTTP 요청에 내재된 것 — 수신하지 않을 수 없습니다 |
| OS | `darwin`, `windows`, `linux` | 올바른 업데이트 패키지를 제공하기 위해 |
| 아키텍처 | `aarch64`, `x86_64` | 올바른 업데이트 패키지를 제공하기 위해 |
| 앱 버전 | `0.5.10` | 업데이트가 있는지 확인하기 위해 |
| 기기 해시 | `a3f8c2...` (64자 16진수) | 익명 기기 카운터 — 호스트명 + OS + 아키텍처의 SHA-256; 역추적 불가 |

전체 URL은 다음과 같습니다:

```text
GET https://log.vmark.app/update/latest.json?target=darwin&arch=aarch64&version=0.5.10
X-Machine-Id: a3f8c2b1d4e5f6078a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1
```

직접 확인할 수 있습니다 — 엔드포인트는 [`tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json) (`"endpoints"` 검색)에 있고, 해시는 [`lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) (`machine_id_hash` 검색)에 있습니다.

## VMark가 전송하지 않는 것

- 문서나 그 내용
- 파일명 또는 경로
- 사용 패턴이나 기능 분석
- 어떤 종류의 개인 정보도 없음
- 충돌 보고서
- 키 입력 또는 편집 데이터
- 역추적 가능한 하드웨어 식별자 또는 지문
- 기기 해시는 단방향 SHA-256 다이제스트입니다 — 호스트명이나 다른 입력을 복원하기 위해 역추적할 수 없습니다

## 데이터 사용 방법

업데이트 확인 로그를 집계하여 [홈페이지](/)에 표시된 라이브 통계를 생성합니다:

| 지표 | 계산 방법 |
|------|---------|
| **고유 기기** | 일/주/월당 고유 기기 해시 수 |
| **고유 IP** | 일/주/월당 고유 IP 주소 수 |
| **핑** | 업데이트 확인 요청의 총 수 |
| **플랫폼** | OS + 아키텍처 조합별 핑 수 |
| **버전** | 앱 버전별 핑 수 |

이 수치들은 [`log.vmark.app/api/stats`](https://log.vmark.app/api/stats)에서 공개적으로 발표됩니다. 숨겨진 것이 없습니다.

**중요한 주의 사항:**
- 고유 IP는 실제 사용자 수를 과소 계산합니다 — 동일한 라우터/VPN 뒤에 있는 여러 사람이 하나로 계산됩니다
- 고유 기기는 더 정확한 수치를 제공하지만 호스트명 변경이나 새 OS 설치는 새 해시를 생성합니다
- 핑은 실제 사용자 수를 과다 계산합니다 — 한 사람이 하루에 여러 번 확인할 수 있습니다

## 데이터 보존

- 로그는 표준 접근 로그 형식으로 서버에 저장됩니다
- 로그 파일은 1 MB에서 순환되고 최근 3개 파일만 유지됩니다
- 로그는 누구와도 공유되지 않습니다
- 계정 시스템이 없습니다 — VMark는 여러분이 누구인지 모릅니다
- 기기 해시는 어떤 계정, 이메일, IP 주소와도 연결되지 않습니다 — 익명 기기 카운터일 뿐입니다
- 추적 쿠키, 지문 수집, 분석 SDK를 사용하지 않습니다

## VMark가 디스크에서 읽을 수 있는 범위

VMark의 파일 접근은 디스크 전체가 아니라 좁게 제한된 권한 범위입니다:

- **정적 범위**: 홈 폴더(`$HOME/**`)와 마운트된 볼륨 — macOS에서는 `/Volumes/**`, Linux에서는 `/mnt/**`와 `/media/**`. Windows에서는 `C:\`부터 `F:\`까지의 드라이브도 포함되므로, 런타임 허가가 필요한 것은 `G:\` 이후의 드라이브와 네트워크 공유뿐입니다. macOS와 Linux에서는 숨김 폴더(이름이 `.`으로 시작하는 폴더) 안에 있는 것은 모두 정적 범위 밖입니다.
- **런타임 허가**: 명시적으로 연 파일 — Finder나 탐색기, `vmark` 명령줄, 파일 대화상자에서 연 파일 — 은 그 파일 하나에 대해서만 허가를 받습니다. **폴더**는 사용자가 직접 선택했다는 것을 VMark가 알 수 있을 때만 허가됩니다. 즉 VMark의 폴더 선택 대화상자에서 골랐거나 Finder에서 연 경우입니다. VMark는 이런 폴더 목록(앱 데이터 폴더의 `workspace-grants.json`)을 보관하고 실행할 때마다 다시 허가하므로, 복원된 세션과 **최근 워크스페이스 열기**가 계속 작동합니다. 이 목록에 없고 정적 범위에도 포함되지 않는 최근 워크스페이스를 열면, 해당 폴더를 연 상태로 폴더 선택 대화상자가 나타납니다 — 그 폴더를 선택해 확인하세요. AI 어시스턴트가 그런 폴더를 열려고 할 때도, 요청을 승인한 뒤 같은 과정을 거칩니다.
- **이미지와 미디어**: 로컬 이미지, 동영상, 오디오는 VMark의 에셋 프로토콜로 표시되며, 이 프로토콜이 닿는 곳도 같습니다 — 정적 범위와 위의 런타임 허가입니다. 미디어 뷰어는 보여 주는 파일 하나에 대해서만, 그리고 미디어 확장자를 가진 파일에 한해서만 허가를 추가합니다. 다른 경로에 대한 요청은 범위를 넓히지 않고 거부됩니다. 이 범위 밖의 이미지 — 예를 들어 정적 범위 밖에서 단독으로 연 문서 옆에 있는 이미지 — 는 그 폴더를 워크스페이스로 열 때까지 표시되지 않습니다.

여기서 어떤 것도 외부로 전송되지 않습니다. 범위는 앱 자체가 무엇을 읽을 수 있는지를 결정합니다.

## 오픈 소스 투명성

VMark는 완전한 오픈 소스입니다. 여기서 설명한 모든 것을 확인할 수 있습니다:

- 업데이트 엔드포인트 구성: [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)
- 기기 해시 생성: [`src-tauri/src/lib.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/lib.rs) — `machine_id_hash` 검색
- 파일 시스템 및 에셋 범위: [`src-tauri/capabilities/default.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/capabilities/default.json), [`src-tauri/tauri.conf.json`](https://github.com/xiaolai/vmark/blob/main/src-tauri/tauri.conf.json)의 `assetProtocol` 항목, [`src-tauri/src/fs_scope.rs`](https://github.com/xiaolai/vmark/blob/main/src-tauri/src/fs_scope.rs), [`src-tauri/src/workspace_grants/`](https://github.com/xiaolai/vmark/tree/main/src-tauri/src/workspace_grants)
- 서버 측 통계 집계: [`scripts/vmark-stats-json`](https://github.com/xiaolai/vmark/blob/main/scripts/vmark-stats-json) — [공개 통계](https://log.vmark.app/api/stats)를 생성하기 위해 서버에서 실행되는 정확한 스크립트
- 코드베이스에 다른 네트워크 호출이 없습니다 — `fetch`, `http`, 또는 `reqwest`를 직접 검색해 보세요

## 업데이트 확인 비활성화

자동 업데이트 확인을 완전히 비활성화하려면 네트워크 수준 (방화벽, `/etc/hosts`, 또는 DNS)에서 `log.vmark.app`을 차단할 수 있습니다. VMark는 없어도 정상적으로 계속 작동합니다 — 업데이트 알림만 받지 못합니다.
