# Graph_RAG_Drone_Viewer · Community Frontier v4

하나의 GitHub Pages에서 두 가지 보기를 전환합니다.

- **Knowledge Graph**: Entity type 색 + 기존 KG layout
- **Community KG**: Community 색 + community-aware layout + hierarchical semantic zoom

## v4 핵심 동작

1. **Zoom 방향 수정**
   - 가장 축소된 상태: **L0 (coarse/root)**
   - 확대: **L1 → L2 → L3 (finer)**

2. **Hierarchy frontier**
   - 정확히 같은 Level이 없다고 Entity를 삭제하지 않습니다.
   - L3 자식이 없는 branch는 L2/L1/L0의 leaf Community로 남습니다.
   - 따라서 확대할 때 그래프 양쪽의 branch가 갑자기 사라지는 문제가 줄어듭니다.

3. **Community node color**
   - Community KG에서 Node 색 = 현재 hierarchy frontier의 Community 색입니다.
   - Sigma/WebGL 안정성을 위해 Node 색은 HSL 문자열이 아니라 HEX로 변환합니다.
   - 같은 frontier depth에서 복수 Community membership이 존재하면 색을 RGB 평균으로 혼합합니다.

4. **Gradient + overlap blending**
   - Community 중심부는 조금 진하고 외곽으로 갈수록 거의 투명해집니다.
   - Community gradient가 공간적으로 겹치면 Canvas alpha blending으로 색이 자연스럽게 섞입니다.

5. **부드러운 윤곽선**
   - 일반 Community의 외곽선은 거의 보이지 않게 낮췄습니다.
   - 선택한 Community만 약하게 경계를 강조합니다.

6. **Community-aware fixed layout**
   - 일반 KG와 Community KG는 서로 다른 고정 좌표를 사용합니다.
   - Community KG 안에서 zoom하는 동안 Node 좌표는 바뀌지 않습니다.

## GitHub에 교체할 파일

현재 저장소의 다음 파일을 이 `docs` 폴더 내용으로 교체하면 됩니다.

```text
Graph_RAG_Drone_Viewer/
├─ index.html
├─ app.js
├─ style.css
├─ .nojekyll
└─ data/
   └─ graph.json
```

이번 v4는 `graph.json` 형식 자체를 바꾸지 않았으므로, 이미 동일한 Community 데이터가 올라가 있다면 실제 기능 수정은 `index.html`, `app.js`, `style.css`만 교체해도 됩니다. 다만 ZIP에는 완전한 세트를 넣어 두었습니다.

- 기본 KG: `.../Graph_RAG_Drone_Viewer/#kg`
- Community KG: `.../Graph_RAG_Drone_Viewer/#community`
