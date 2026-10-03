# Graph_RAG_Drone_Viewer · Combined

하나의 GitHub Pages 화면에서 두 가지 그래프 보기를 전환합니다.

- **Knowledge Graph**: Entity + Relationship만 표시
- **Community KG**: 동일 KG 위에 Hierarchical Leiden Community 배경과 Community 상세정보를 추가

두 보기 모두 같은 `data/graph.json`을 사용합니다. Community 결과가 포함된 JSON 하나만 저장하므로 일반 KG용 JSON을 중복 저장할 필요가 없습니다.

## GitHub에 올릴 파일

저장소 루트에 다음 구조가 되도록 올립니다.

```text
Graph_RAG_Drone_Viewer/
├─ index.html
├─ app.js
├─ style.css
├─ .nojekyll
├─ data/
│  └─ graph.json
└─ scripts/
   └─ export_community_kg_for_web.py   # 재생성할 때만 필요
```

홈페이지 실행에는 `scripts` 폴더가 필수는 아닙니다.

## GitHub Pages

Settings → Pages → Deploy from a branch → `main` → `/(root)` → Save

## 보기 전환 링크

- 기본 KG: `.../Graph_RAG_Drone_Viewer/#kg`
- Community KG: `.../Graph_RAG_Drone_Viewer/#community`

페이지 상단 버튼으로도 즉시 전환할 수 있습니다.
