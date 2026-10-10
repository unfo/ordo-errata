import pytest

from sm2data import ssl

SAMPLE = '''sslModule   =   "weapons.melee.melee_weapon_desc"
healthDamage   =   12.1
count   =   -3
enabled   =   True
weaponType   =   HAMMER_ONE_HANDED
versions   =   {
   "01"   =   {
      nameUid   =   "UI_X_01_NAME"
      __type   =   "MeleeUiVersionData"
   }
}
perks   =   [
   "A",
   "B"
]
layers   =   [
   [
      { perkUid   =   "p1" },
      { perkUid   =   "p2" }
   ]
]
node   =   {
   #ssl_begin
      if x == "}" { return [ }
   #ssl_end
   after   =   1
}
'''


def test_parses_scalars_objects_and_lists():
    d = ssl.loads(SAMPLE)
    assert d["sslModule"] == "weapons.melee.melee_weapon_desc"
    assert d["healthDamage"] == 12.1
    assert d["count"] == -3
    assert d["enabled"] is True
    assert d["weaponType"] == "HAMMER_ONE_HANDED"
    assert d["versions"]["01"] == {"nameUid": "UI_X_01_NAME", "__type": "MeleeUiVersionData"}
    assert d["perks"] == ["A", "B"]
    assert d["layers"] == [[{"perkUid": "p1"}, {"perkUid": "p2"}]]


def test_skips_embedded_script_blocks():
    assert ssl.loads(SAMPLE)["node"] == {"after": 1}


def test_accepts_bytes_with_bom():
    assert ssl.loads("a   =   1".encode("utf-8-sig")) == {"a": 1}


@pytest.mark.parametrize("bad", ["a = {", "a = [1, 2", "a 1", "= 1"])
def test_rejects_malformed(bad):
    with pytest.raises(ssl.SslParseError):
        ssl.loads(bad)
