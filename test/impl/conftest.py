"""pytest 수집 제어 — impl 하위 공통.

`run_test.py` 는 `python3 test/impl/<N>/run_test.py` 로 직접 실행하는 수동 하니스인데
pytest 기본 패턴(`*_test.py`)에 오탐 수집되어 import mismatch(동명 모듈)를 일으킨다.
수동 하니스는 수집에서 제외한다 (impl/51·53 등).
"""
collect_ignore_glob = ["*/run_test.py"]
