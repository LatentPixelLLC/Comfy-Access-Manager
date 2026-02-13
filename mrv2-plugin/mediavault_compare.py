# SPDX-License-Identifier: MIT
# MediaVault Compare Plugin for mrViewer2
#
# Adds "MediaVault" menu to mrv2 with:
#   - Compare by Role  → picks a role, loads latest version, enters wipe compare
#   - Select Version…  → shows all versions across all roles, pick one to compare
#
# Requires MediaVault server running on localhost:7700
#
# Installation:
#   Create a junction/symlink so mrv2 finds this plugin:
#     mklink /J "C:\Program Files\vmrv2-v1.5.4\python\plug-ins\mediavault" "C:\MediaVault\mrv2-plugin"
#   Or copy this file to:
#     C:\Program Files\vmrv2-v1.5.4\python\plug-ins\mediavault\mediavault_compare.py
#

import mrv2
from mrv2 import cmd, media

import json
import os
import urllib.request
import urllib.parse

MEDIAVAULT_URL = "http://localhost:7700"


class MediaVaultComparePlugin(mrv2.plugin.Plugin):
    """Plugin that queries MediaVault for sibling versions and loads them for A/B compare."""

    def __init__(self):
        super().__init__()

    def active(self):
        return True

    # ─── Helpers ───

    def _get_current_file_path(self):
        """Get the file path of the first loaded media item."""
        items = media.list()
        if not items:
            return None
        # media item path object has .get() method
        return items[0].path.get()

    def _fetch_compare_targets(self, file_path):
        """
        Query MediaVault for sibling versions of the given file.
        Returns { asset: {...}, roles: [{ name, assets: [{file_path, version, ...}] }] }
        """
        encoded_path = urllib.parse.quote(file_path, safe='')
        url = f"{MEDIAVAULT_URL}/api/assets/compare-targets-by-path?path={encoded_path}"
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            print(f"[MediaVault] Error fetching compare targets: {e}")
            return None

    def _load_and_compare(self, file_path):
        """Load a second file into mrv2 and enter Wipe compare mode."""
        # Open the comparison file as B clip
        cmd.open(file_path)

        items = media.list()
        if len(items) < 2:
            print("[MediaVault] Could not load comparison file")
            return

        # Set A = first item (index 0), B = last loaded item
        b_index = len(items) - 1
        media.setA(0)
        media.setB(b_index, True)

        # Set Wipe compare mode
        opts = cmd.compareOptions()
        opts.mode = media.CompareMode.Wipe
        opts.wipeCenter.x = 0.5
        opts.wipeRotation = 0.0
        cmd.setCompareOptions(opts)

        # Give UI time to update
        time = 0.0
        while time < 0.15:
            time += cmd.update()

        print(f"[MediaVault] Wipe compare active: {items[0].path.get()} vs {file_path}")

    def _show_role_picker(self, roles):
        """
        Show a simple FLTK dialog listing roles.
        Returns the selected role dict or None.
        """
        from fltk import (Fl, Fl_Double_Window, Fl_Hold_Browser, Fl_Button,
                          FL_COURIER, fl_alert)

        if not roles:
            fl_alert("No other versions found in this shot.")
            return None

        result = [None]  # mutable container for callback

        win = Fl_Double_Window(350, 320, "Compare by Role")
        win.set_modal()

        browser = Fl_Hold_Browser(10, 10, 330, 260, "")
        browser.textfont(FL_COURIER)
        browser.textsize(13)

        for role in roles:
            latest = role['assets'][0] if role['assets'] else None
            if latest:
                v = latest.get('version', '?')
                ext = latest.get('file_ext', '')
                label = f"  {role['name']:16s}  v{str(v).zfill(3)}  {ext}"
            else:
                label = f"  {role['name']:16s}  (empty)"
            browser.add(label)

        def on_ok(ptr):
            sel = browser.value()
            if sel > 0:
                result[0] = roles[sel - 1]  # browser is 1-indexed
            win.hide()

        def on_cancel(ptr):
            win.hide()

        btn_ok = Fl_Button(140, 280, 90, 30, "Compare")
        btn_ok.callback(on_ok)

        btn_cancel = Fl_Button(250, 280, 90, 30, "Cancel")
        btn_cancel.callback(on_cancel)

        win.end()
        win.show()

        while win.visible():
            Fl.wait(0.05)

        return result[0]

    def _show_version_picker(self, roles):
        """
        Show a dialog listing ALL versions across all roles.
        Returns the selected asset dict or None.
        """
        from fltk import (Fl, Fl_Double_Window, Fl_Hold_Browser, Fl_Button,
                          FL_COURIER, fl_alert)

        # Flatten all assets with role context
        all_items = []
        for role in roles:
            for asset in role['assets']:
                all_items.append((role, asset))

        if not all_items:
            fl_alert("No other versions found in this shot.")
            return None

        result = [None]

        win = Fl_Double_Window(450, 380, "Select Version to Compare")
        win.set_modal()

        browser = Fl_Hold_Browser(10, 10, 430, 320, "")
        browser.textfont(FL_COURIER)
        browser.textsize(13)

        for role, asset in all_items:
            v = asset.get('version', '?')
            ext = asset.get('file_ext', '')
            name = asset.get('vault_name', '???')
            label = f"  {role['name']:12s}  v{str(v).zfill(3)}  {ext:6s}  {name}"
            browser.add(label)

        def on_ok(ptr):
            sel = browser.value()
            if sel > 0:
                result[0] = all_items[sel - 1][1]  # return the asset dict
            win.hide()

        def on_cancel(ptr):
            win.hide()

        btn_ok = Fl_Button(230, 345, 100, 30, "Compare")
        btn_ok.callback(on_ok)

        btn_cancel = Fl_Button(345, 345, 100, 30, "Cancel")
        btn_cancel.callback(on_cancel)

        win.end()
        win.show()

        while win.visible():
            Fl.wait(0.05)

        return result[0]

    # ─── Menu Actions ───

    def compare_by_role(self):
        """Show roles in this shot, load the latest version of the selected role."""
        file_path = self._get_current_file_path()
        if not file_path:
            from fltk import fl_alert
            fl_alert("No media loaded. Open a file first.")
            return

        data = self._fetch_compare_targets(file_path)
        if not data or not data.get('roles'):
            from fltk import fl_alert
            fl_alert("No other versions found for this file.\n"
                     "Make sure MediaVault is running on localhost:7700\n"
                     "and this file is imported into a shot.")
            return

        role = self._show_role_picker(data['roles'])
        if role and role['assets']:
            # First asset is latest (sorted version DESC by API)
            latest = role['assets'][0]
            target_path = latest.get('file_path')
            if target_path and os.path.exists(target_path):
                self._load_and_compare(target_path)
            else:
                from fltk import fl_alert
                fl_alert(f"File not found:\n{target_path}")

    def select_version(self):
        """Show all versions across all roles, let user pick one to compare."""
        file_path = self._get_current_file_path()
        if not file_path:
            from fltk import fl_alert
            fl_alert("No media loaded. Open a file first.")
            return

        data = self._fetch_compare_targets(file_path)
        if not data or not data.get('roles'):
            from fltk import fl_alert
            fl_alert("No other versions found for this file.\n"
                     "Make sure MediaVault is running on localhost:7700\n"
                     "and this file is imported into a shot.")
            return

        asset = self._show_version_picker(data['roles'])
        if asset:
            target_path = asset.get('file_path')
            if target_path and os.path.exists(target_path):
                self._load_and_compare(target_path)
            else:
                from fltk import fl_alert
                fl_alert(f"File not found:\n{target_path}")

    # ─── Menus ───

    def menus(self):
        """Register menu items under MediaVault in mrv2's menu bar."""
        return {
            "MediaVault/Compare by Role": self.compare_by_role,
            "MediaVault/Select Version...": (self.select_version, '__divider__'),
        }
