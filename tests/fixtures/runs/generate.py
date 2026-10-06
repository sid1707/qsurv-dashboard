"""Regenerates the sample run exports in this folder: python tests/fixtures/runs/generate.py

Placeholder kits (supabase/migrations/20260930120400_seed_placeholder_kits.sql),
one tube each, preset layout with tubes in rows:
  one sample per plate:  A1-A3 unknown, A4 positive control, A5 negative control
  two samples per plate: A1-A6 unknown (either sample, told apart by identifier), A7 PC, A8 NC

Centres used in the tests (file names <Centre ID>_<Name>_<Location>_<DDMMYY>):
  C01 HuwelLab, Pune     -> C01_HuwelLab_Pune_...
  C02 EnvLab, Mumbai     -> C02_EnvLab_Mumbai_...
"""

import os

OUT = os.path.dirname(os.path.abspath(__file__))

MULTIPATHOGEN = [
    ("Target A", "FAM", ["24.512", "24.731", "24.402"], "21.904"),
    ("Target B", "HEX", ["27.118", "27.305", "26.988"], "22.417"),
    ("Internal Control", "CY5", ["25.301", "25.122", "25.410"], "24.880"),
]
ENVIRONMENTAL = [
    ("Target X", "FAM", ["23.41", "23.62", "23.37"], "21.20"),
    ("Target Y", "ROX", ["29.05", "28.88", "29.21"], "22.73"),
    ("Internal Control", "Cy5", ["26.10", "26.31", "25.97"], "25.40"),
]


def ct(target, role, i, nc_value):
    _, _, unknown, pc = target
    return {"unknown": unknown[i % 3], "pc": pc, "nc": nc_value}[role]


def quantstudio(targets, wells, experiment):
    """wells: [(well, role, sample_name)]. QuantStudio results export."""
    lines = [
        "* Block Type = 96-Well Block (0.2mL)",
        f"* Experiment Name = {experiment}",
        "* Instrument Type = QuantStudio 5 System",
        "* Passive Reference = ROX",
        "",
        "[Results]",
        "Well,Well Position,Omit,Sample Name,Target Name,Task,Reporter,Quencher,CT,Ct Mean,Ct SD",
    ]
    task = {"unknown": "UNKNOWN", "pc": "STANDARD", "nc": "NTC"}
    for i, (well, role, sample) in enumerate(wells):
        number = (ord(well[0]) - 65) * 12 + int(well[1:])
        for t in targets:
            lines.append(f"{number},{well},false,{sample},{t[0]},{task[role]},{t[1]},NFQ-MGB,{ct(t, role, i, 'Undetermined')},,")
    return "\n".join(lines) + "\n"


def cfx(targets, wells):
    """wells: [(well, role, sample, biological_set)]. Bio-Rad CFX Quantification Cq Results."""
    lines = [",Well,Fluor,Target,Content,Sample,Biological Set Name,Cq,Cq Mean,Cq Std. Dev"]
    content = {"unknown": "Unkn", "pc": "Pos Ctrl", "nc": "NTC"}
    for i, (well, role, sample, bio) in enumerate(wells):
        padded = f"{well[0]}{int(well[1:]):02d}"
        for t in targets:
            lines.append(f",{padded},{t[1]},{t[0]},{content[role]},{sample},{bio},{ct(t, role, i, 'NaN')},,")
    return "\n".join(lines) + "\n"


ONE = [("A1", "unknown", "WW-PUNE-01"), ("A2", "unknown", "WW-PUNE-01"), ("A3", "unknown", "WW-PUNE-01"), ("A4", "pc", "PC"), ("A5", "nc", "NTC")]
# Controls loaded at the start of the row instead of the end.
ONE_SWAPPED = [("A1", "pc", "PC"), ("A2", "nc", "NTC"), ("A3", "unknown", "WW-PUNE-01"), ("A4", "unknown", "WW-PUNE-01"), ("A5", "unknown", "WW-PUNE-01")]

d1, d2 = "WW_01102026", "WW_08102026"
TWO_DATES = [("A1", "unknown", d1), ("A2", "unknown", d1), ("A3", "unknown", d1),
             ("A4", "unknown", d2), ("A5", "unknown", d2), ("A6", "unknown", d2),
             ("A7", "pc", "PC"), ("A8", "nc", "NTC")]
# The same two samples scattered over the unknown wells: sample 1 in A1, A2, A4 and
# sample 2 in A3, A5, A6. Splitting goes by identifier, so this is fine.
TWO_DATES_SCATTERED = [("A1", "unknown", d1), ("A2", "unknown", d1), ("A3", "unknown", d2),
                   ("A4", "unknown", d1), ("A5", "unknown", d2), ("A6", "unknown", d2),
                   ("A7", "pc", "PC"), ("A8", "nc", "NTC")]

TWO_SITES = [("A1", "unknown", "WW-ETP", "ETP"), ("A2", "unknown", "WW-ETP", "ETP"), ("A3", "unknown", "WW-ETP", "ETP"),
             ("A4", "unknown", "WW-STP", "STP"), ("A5", "unknown", "WW-STP", "STP"), ("A6", "unknown", "WW-STP", "STP"),
             ("A7", "pc", "PC", ""), ("A8", "nc", "NTC", "")]

FILES = {
    "C01_HuwelLab_Pune_01102026_quantstudio5.csv": quantstudio(MULTIPATHOGEN, ONE, "C01_HuwelLab_Pune_01102026"),
    "C01_HuwelLab_Pune_01102026_quantstudio5_wrong-layout.csv": quantstudio(MULTIPATHOGEN, ONE_SWAPPED, "C01_HuwelLab_Pune_01102026"),
    "C02_EnvLab_Mumbai_01102026_cfx96.csv": cfx(ENVIRONMENTAL, [(w, r, s, "") for w, r, s in ONE]),
    "C01_HuwelLab_Pune_01102026_08102026_two-dates.csv": quantstudio(MULTIPATHOGEN, TWO_DATES, "C01_HuwelLab_Pune"),
    "C01_HuwelLab_Pune_01102026_08102026_two-dates_scattered.csv": quantstudio(MULTIPATHOGEN, TWO_DATES_SCATTERED, "C01_HuwelLab_Pune"),
    "C02_EnvLab_Mumbai_01102026_two-sites.csv": cfx(ENVIRONMENTAL, TWO_SITES),
}

if __name__ == "__main__":
    for name, text in FILES.items():
        with open(os.path.join(OUT, name), "w", newline="\n") as f:
            f.write(text)
        print(name)
