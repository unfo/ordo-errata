from sm2data.strings import StringTable, render_description


def test_numbered_placeholders():
    r = render_description(
        "Enemies take {STRING1} more Ranged Damage (Base: {STRING2})",
        [{"text": "40%"}, {"text": "50%", "type": "POSITIVE"}],
    )
    assert r["text"] == "Enemies take 40% more Ranged Damage (Base: 50%)"
    assert {"v": "50%", "kind": "POSITIVE"} in r["parts"]


def test_bare_placeholder_is_first_param():
    r = render_description("Radius is increased by {STRING}", [{"text": "25%"}])
    assert r["text"] == "Radius is increased by 25%"


def test_enemy_presence_takes_string1():
    r = render_description(
        "Melee kills of {STRING1}[majoris]Majoris[/majoris]-level or higher enemies restore Health by {STRING2}",
        [{"text": "5%"}],
        ["MAJORIS"],
    )
    assert r["text"] == "Melee kills of Majoris-level or higher enemies restore Health by 5%"
    assert {"enemy": "MAJORIS"} in r["parts"]
    assert {"tag": "majoris", "t": "Majoris"} in r["parts"]


def test_missing_param_is_flagged():
    r = render_description("Lasts {STRING2} seconds", [{"text": "5"}])
    assert {"v": "{STRING2}", "missing": True} in r["parts"]


def test_recover_broken_desc_key():
    t = StringTable("english")
    t.malformed.append({"line": 2, "key": "Rapid Recharge", "text": "Reaching...", "prev_key": "X_02_NAME"})
    assert t.recover("X_02_DESC")["text"] == "Reaching..."
    assert t.recover("X_03_DESC") is None
    assert t.recover("X_02_NAME") is None


def test_deobfuscate_xor_hex_strings():
    from sm2data.strings import deobfuscate

    assert deobfuscate("6d3s989ddb8ddaedda9dd") == "Test"
    assert deobfuscate("6d3s9ffd1ffd1ffd1") == "..."
    assert deobfuscate("Plain text") == "Plain text"


def test_two_enemy_tiers_take_string1_and_string2():
    r = render_description(
        "Melee Damage increases by {STRING3} against {STRING1}[majoris]Majoris[/majoris]- or {STRING2}[extremis]Extremis[/extremis]-level enemies",
        [{"text": "15%"}],
        ["MAJORIS", "EXTREMIS"],
    )
    assert r["text"] == "Melee Damage increases by 15% against Majoris- or Extremis-level enemies"
    assert [p for p in r["parts"] if "enemy" in p] == [{"enemy": "MAJORIS"}, {"enemy": "EXTREMIS"}]
