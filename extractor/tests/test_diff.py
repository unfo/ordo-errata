import copy
import json
from pathlib import Path

import pytest

import diff as diffmod

DATA = Path(__file__).resolve().parents[2] / "data"
LATEST = json.loads((DATA / "builds.json").read_text())["latest"]


@pytest.fixture()
def snaps():
    snap = diffmod.load(LATEST)
    return snap, copy.deepcopy(snap)


def weapon(snap, wid):
    return next(w for w in snap["weapons"]["weapons"] if w["id"] == wid)


def test_identical_builds_have_no_changes(snaps):
    old, new = snaps
    assert diffmod.diff_perks(old, new) == {}
    assert diffmod.diff_weapons(old, new) == {}
    assert diffmod.diff_values(old, new) == {}


def test_value_change_reports_percentage(snaps):
    old, new = snaps
    path = "pve.cartridgeDescriptions.bolts.shotCreatorSettings.damage"
    new["values"]["weapon:shotgun_meltagun"][path] *= 1.65
    ch = diffmod.diff_values(old, new)["weapon:shotgun_meltagun"]
    assert ch == [{"kind": "value", "field": path, "old": 49.5, "new": pytest.approx(81.675), "pct": 65.0}]


def test_perk_values_are_keyed_by_type(snaps):
    old, new = snaps
    key = "perk:PvEMeleeThunderHammerOneHandedPowerIncreaseOnMaxCharges"
    new["values"][key]["activationController.delayedResetSec"] = 15
    assert "perkType:PvEMeleeThunderHammerOneHandedPowerIncreaseOnMaxCharges" in diffmod.diff_values(old, new)


def test_perk_text_param_and_replacement(snaps):
    old, new = snaps
    col = new["classes"]["classes"][0]["pve"]["columns"][0]["slots"][0]
    removed = col["perks"][0]
    col["perks"][0] = {**removed, "id": "NewPerk", "name": "Shiny"}
    hammer = weapon(new, "melee_thunder_hammer_one_handed")
    perk = hammer["tiers"][1]["layers"][2][0]
    perk["params"] = [{"text": "10%"}, {"text": "15"}]
    d = diffmod.diff_perks(old, new)
    assert d[f"perk:{removed['id']}"][0]["kind"] == "removed"
    assert d["perk:NewPerk"][0]["kind"] == "added"
    assert d[f"perk:{perk['id']}"] == [{"kind": "field", "field": "values", "old": ["10%", "20"], "new": ["10%", "15"]}]


def test_variant_stat_change(snaps):
    old, new = snaps
    weapon(new, "hgun_plasma_pistol")["variants"][0]["stats"]["firePower"] = 4
    assert diffmod.diff_weapons(old, new) == {
        "variant:hgun_plasma_pistol/01": [{"kind": "stat", "field": "firePower", "old": 3.5, "new": 4}]
    }
