# Graph_RAG_Drone_Viewer · Community Frontier v2

하나의 GitHub Pages에서 두 가지 보기를 전환합니다.

- **Knowledge Graph**: 기존 `graphviz-sfdp` 좌표에서 Entity + Relationship 표시
- **Community KG**: Community-aware 고정 좌표에서 Hierarchical Leiden Community를 함께 표시

## v2 패치 내용

1. **Hierarchy frontier semantic zoom**
   - 단순히 정확한 Level만 표시하지 않습니다.
   - 확대할수록 각 Entity가 실제로 가진 가장 깊은 Community까지 세분화됩니다.
   - 예를 들어 어떤 branch가 L1에서 끝나면 L2/L3 확대에서도 그 L1 Community가 사라지지 않습니다.

2. **Community gradient**
   - Community 중심부가 상대적으로 진하고 외곽으로 갈수록 투명해집니다.
   - gradient는 Community hull 내부로 clip됩니다.

3. **Community-aware layout**
   - 일반 KG와 Community KG가 서로 다른 좌표를 사용합니다.
   - Community KG에서는 Hierarchical Leiden anchor를 이용해 같은 Community Entity가 공간적으로 더 가까워지도록 미리 계산했습니다.
   - Community KG 안에서 확대/축소할 때 Node 좌표는 다시 계산하지 않습니다. 즉 zoom 중 mental map은 유지됩니다.

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

GitHub Pages가 이미 `main / (root)`로 설정되어 있다면 Pages 설정은 다시 할 필요가 없습니다.

- 기본 KG: `.../Graph_RAG_Drone_Viewer/#kg`
- Community KG: `.../Graph_RAG_Drone_Viewer/#community`
