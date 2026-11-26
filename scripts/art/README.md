# 직접 제작 그래픽 생성 스크립트

이 폴더의 Python 스크립트(Pillow)는 `public/assets/` 의 그래픽을 코드로 그려 만듭니다.
선수·키퍼·코치 스프라이트(`gen_v1.py` ~ `gen5.py`)와 경기장·그라운드·골대·공·트로피(`stadium_art.py`)가 모두 여기서 나옵니다.
외부 이미지 파일을 읽거나 복사하지 않으며, 결과물의 별도 라이선스는 아직 지정하지 않았습니다(저장소 소유자가 정하기 전까지 재사용 조건 미정).

```bash
pip install pillow
python3 scripts/art/stadium_art.py public/assets          # 경기장·소품·타일
python3 scripts/art/gen5.py /tmp/out full                 # 선수 스프라이트 (/tmp/out/cast)
```
