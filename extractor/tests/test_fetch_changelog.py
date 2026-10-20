import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("fetch_changelog", Path(__file__).resolve().parents[2] / "tools" / "fetch_changelog.py")
fc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fc)


def test_bbcode_headings_lists_and_emphasis():
    src = (
        "[h1][b]Hotfix 15.1[/b][/h1][p][img src=\"x\"][/img][/p][h2][b]GAMEPLAY[/b][/h2]"
        "[p align=\"start\"][b]Melta Rifle[/b][/p][list][*][p]Ammo [i]up[/i].[/p][/*]"
        "[*][p]Outer[/p][list][*][p]Inner[/p][/*][/list][/*][/list]"
        "[olist][*]First[/*][*]Second[/*][/olist][p]See [url=https://x.test]notes[/url].[/p]"
    )
    assert fc.bbcode_to_markdown(src) == (
        "# Hotfix 15.1\n\n## GAMEPLAY\n\n**Melta Rifle**\n- Ammo *up*.\n- Outer\n    - Inner\n\n"
        "1. First\n2. Second\n\nSee [notes](https://x.test).\n"
    )


def test_changelog_ids_from_titles():
    assert fc.changelog_id("Hotfix 15.1 Patch Notes") == "15.1-hotfix"
    assert fc.changelog_id("Patch Notes 14.0") == "14.0-patch"
    assert fc.changelog_id("Patch 15.0") == "15.0-patch"
    assert fc.changelog_id("Community Update") is None


def test_adjacent_bold_paragraphs_stay_separate():
    src = "[p][b]Melee in PvE[/b][/p][p][/p][p][b]One-Handed Thunder Hammer[/b][/p][list][*]X[/*][/list]"
    assert fc.bbcode_to_markdown(src) == "**Melee in PvE**\n**One-Handed Thunder Hammer**\n- X\n"
