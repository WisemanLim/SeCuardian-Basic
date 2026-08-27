"""다국어 name/description 공통 파서 (R18-7·§7.11.2-5).

모든 에이전트·자산의 이름/설명은 {"ko": …, "en": …, "jp": …} 형 dict 데이터로 저장하고,
이 모듈의 공통 함수로만 파싱한다 — 언어 추가(jp/ch/…) 시 코드 수정 없이 데이터만 확장.
"""
import json


def norm_descriptions(meta: dict) -> dict:
    """meta 의 description/display_name 을 다국어 dict 로 정규화.

    허용 형식 — ① dict 형: description={"ko": "...", "en": "..."} (확장형, 타 언어 키 허용)
               ② 레거시: description(문자열=ko) + description_en(문자열=en)
    정규화 후 meta 에는 세 키가 모두 존재: description(ko 문자열, 하위호환),
    description_en(en 문자열, 하위호환), descriptions(dict).
    display_name 도 동일 규칙으로 agent_names(dict) 를 채운다.
    """
    desc = meta.get("description")
    d: dict[str, str] = {}
    if isinstance(desc, dict):
        d = {k: v for k, v in desc.items() if isinstance(v, str) and v.strip()}
    elif isinstance(desc, str) and desc.strip():
        d["ko"] = desc.strip()
    en = meta.get("description_en")
    if isinstance(en, str) and en.strip():
        d.setdefault("en", en.strip())
    # dict 형이 넘어온 경우에도 legacy 키 병행 유지
    existing = meta.get("descriptions")
    if isinstance(existing, dict):
        for k, v in existing.items():
            if isinstance(v, str) and v.strip():
                d.setdefault(k, v.strip())
    meta["descriptions"] = d
    meta["description"] = d.get("ko", "")
    meta["description_en"] = d.get("en", "")
    # display_name 도 dict 형(다국어) 허용 → agent_names 정규화
    disp = meta.get("display_name")
    names: dict[str, str] = {}
    if isinstance(disp, dict):
        names = {k: v for k, v in disp.items() if isinstance(v, str) and v.strip()}
    elif isinstance(disp, str) and disp.strip():
        names["ko"] = disp.strip()
    existing_names = meta.get("agent_names")
    if isinstance(existing_names, dict):
        for k, v in existing_names.items():
            if isinstance(v, str) and v.strip():
                names.setdefault(k, v.strip())
    meta["agent_names"] = names
    meta["display_name"] = names.get("ko", "") or (disp if isinstance(disp, str) else "")
    return meta


def _lang_entries(obj: dict) -> dict:
    return {k: v for k, v in obj.items() if isinstance(v, str) and v.strip()}


def parse_lang_map(raw) -> dict:
    """DB TEXT(JSON)·dict 어느 쪽이든 {lang: text} dict 로 파싱 (공통 함수, 빈 값 제외)."""
    if not raw:
        return {}
    if isinstance(raw, dict):
        return _lang_entries(raw)
    try:
        obj = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return _lang_entries(obj) if isinstance(obj, dict) else {}


def lang_json(d: dict | None) -> str:
    """{lang: text} dict → DB 저장용 JSON TEXT (빈 dict 는 '')."""
    return json.dumps(d, ensure_ascii=False) if d else ""
