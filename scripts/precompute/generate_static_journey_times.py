"""Generate static journey times based on known UK rail timetables.

This script creates journey_times_{terminus}.json files using approximate
journey times from published timetable data. This provides a reliable
baseline that doesn't depend on API availability.

Each station is mapped to its primary terminus (or termini) with a typical
peak-hour fastest journey time.
"""

import json
from pathlib import Path
from typing import Any

# Station -> terminus mappings with approximate journey times (minutes)
# Based on typical weekday morning peak fastest services
# Format: {station_crs: {terminus_crs: journey_minutes}}
STATION_TERMINUS_TIMES: dict[str, dict[str, int]] = {
    # === Thameslink / East Midlands (STP / BFR) ===
    "BDM": {"STP": 41, "BFR": 49},   # Bedford
    "FLT": {"STP": 48, "BFR": 56},   # Flitwick
    "HIT": {"STP": 30, "KGX": 27},   # Hitchin
    "SVG": {"KGX": 22, "STP": 28},   # Stevenage
    "ARL": {"STP": 35, "BFR": 43},   # Arlesey
    "BIW": {"STP": 39, "BFR": 47},   # Biggleswade
    "SDY": {"STP": 43, "BFR": 51},   # Sandy
    "LUT": {"STP": 25, "BFR": 33},   # Luton
    "SAC": {"STP": 20, "BFR": 28},   # St Albans City
    "LTN": {"STP": 28, "BFR": 36},   # Luton Airport Parkway
    "WGC": {"KGX": 25, "STP": 32},   # Welwyn Garden City
    "HFD": {"KGX": 45},              # Hertford North
    "HTF": {"KGX": 22},              # Hatfield

    # === Great Northern / LNER (KGX) ===
    "CBG": {"KGX": 50},              # Cambridge
    "PBO": {"KGX": 46},              # Peterborough
    "GRA": {"KGX": 67},              # Grantham
    "RYS": {"KGX": 42},              # Royston
    "ELY": {"KGX": 68},              # Ely
    "KLN": {"KGX": 100},             # King's Lynn
    "NRK": {"KGX": 75},              # Newark North Gate
    "DON": {"KGX": 95},              # Doncaster
    "YRK": {"KGX": 112},             # York
    "LDS": {"KGX": 130},             # Leeds
    "DAR": {"KGX": 150},             # Darlington
    "DHM": {"KGX": 170},             # Durham
    "NCL": {"KGX": 178},             # Newcastle
    "EDB": {"KGX": 260},             # Edinburgh Waverley

    # === East Midlands Railway (STP) ===
    "MHR": {"STP": 58},              # Market Harborough
    "LEI": {"STP": 68},              # Leicester
    "KET": {"STP": 52},              # Kettering
    "WEL": {"STP": 55},              # Wellingborough
    "NOT": {"STP": 100},             # Nottingham
    "DBY": {"STP": 90},              # Derby
    "LBO": {"STP": 78},              # Loughborough
    "SHF": {"STP": 110},             # Sheffield

    # === Great Western (PAD) ===
    "RDG": {"PAD": 25},              # Reading
    "SWI": {"PAD": 53},              # Swindon
    "OXF": {"PAD": 55},              # Oxford
    "DDG": {"PAD": 40},              # Didcot Parkway
    "SLO": {"PAD": 17},              # Slough
    "BRI": {"PAD": 97},              # Bristol Temple Meads
    "BPW": {"PAD": 85},              # Bristol Parkway
    "BTH": {"PAD": 84},              # Bath Spa
    "EXD": {"PAD": 130},             # Exeter St Davids
    "PLY": {"PAD": 195},             # Plymouth
    "TAU": {"PAD": 105},             # Taunton
    "CDF": {"PAD": 120},             # Cardiff Central
    "SWA": {"PAD": 170},             # Swansea
    "NWP": {"PAD": 110},             # Newport
    "WOS": {"PAD": 125},             # Worcester Shrub Hill
    "CNM": {"PAD": 120},             # Cheltenham Spa
    "GLO": {"PAD": 110},             # Gloucester
    "TBY": {"PAD": 275},             # Tenby

    # === South Western (WAT) ===
    "BSK": {"WAT": 44},              # Basingstoke
    "WOK": {"WAT": 24},              # Woking
    "GLD": {"WAT": 35},              # Guildford
    "WIN": {"WAT": 60},              # Winchester
    "SOA": {"WAT": 68},              # Southampton Airport Parkway
    "SOU": {"WAT": 75},              # Southampton Central
    "BMH": {"WAT": 106},             # Bournemouth
    "TWI": {"WAT": 20},              # Twickenham
    "PMH": {"WAT": 90},              # Portsmouth Harbour

    # === Southern / Thameslink (VIC / BFR) ===
    "GTW": {"VIC": 30, "BFR": 36},   # Gatwick Airport
    "BTN": {"VIC": 55, "BFR": 72},   # Brighton
    "HHE": {"VIC": 40, "BFR": 52},   # Haywards Heath
    "ECR": {"VIC": 15, "BFR": 20},   # East Croydon
    "HSK": {"VIC": 48, "BFR": 57},   # Hassocks

    # === Central London interchanges ===
    "CTK": {"BFR": 2, "STP": 4},     # City Thameslink
    "STP": {"STP": 0},               # St Pancras itself
    "CLJ": {"VIC": 5, "WAT": 7},     # Clapham Junction
    "SRA": {"LST": 7},               # Stratford

    # === Greater Anglia (LST) ===
    "CHM": {"LST": 30},              # Chelmsford
    "COL": {"LST": 50},              # Colchester
    "IPS": {"LST": 68},              # Ipswich
    "NRW": {"LST": 112},             # Norwich
    "SNF": {"LST": 22},              # Shenfield
    "SOV": {"LST": 55},              # Southend Victoria

    # === Southeastern (CHX / CST / VIC) ===
    "TBD": {"CHX": 50, "CST": 50},   # Tunbridge Wells
    "SEV": {"CHX": 30},              # Sevenoaks
    "ORP": {"CHX": 17, "VIC": 15},   # Orpington
    "TON": {"CHX": 35, "CST": 38},   # Tonbridge
    "ASF": {"STP": 38, "CHX": 80},   # Ashford International (HS1 to STP)
    "CBW": {"STP": 56},              # Canterbury West (HS1)
    "DVP": {"STP": 62},              # Dover Priory (HS1)
    "MDS": {"VIC": 60},              # Maidstone East
    "RTR": {"STP": 35, "VIC": 50},   # Rochester
    "BMS": {"VIC": 18},              # Bromley South
    "DFD": {"CHX": 30, "CST": 28},   # Dartford
    "GRV": {"CHX": 38, "CST": 36},   # Gravesend
    "SOE": {"CST": 55},              # Southend East (c2c)

    # === West Midlands / Avanti West Coast (EUS) ===
    "NMP": {"EUS": 55},              # Northampton (note: different from NNG)
    "NNG": {"EUS": 55},              # Northampton
    "MKC": {"EUS": 33},              # Milton Keynes Central
    "BLY": {"EUS": 45},              # Bletchley
    "BHM": {"EUS": 82},              # Birmingham New Street
    "COV": {"EUS": 60},              # Coventry
    "RUG": {"EUS": 52},              # Rugby
    "WVH": {"EUS": 96},              # Wolverhampton
    "STA": {"EUS": 75},              # Stafford
    "SOT": {"EUS": 90},              # Stoke-on-Trent
    "CRE": {"EUS": 90},              # Crewe
    "MAN": {"EUS": 125},             # Manchester Piccadilly
    "LIV": {"EUS": 130},             # Liverpool Lime Street
    "LMS": {"EUS": 75},              # Leamington Spa
    "BAN": {"EUS": 65},              # Banbury
    "WFJ": {"EUS": 16},              # Watford Junction
    "HML": {"EUS": 25},              # Hemel Hempstead
    "BKG": {"EUS": 28},              # Berkhamsted
    "TRI": {"EUS": 32},              # Tring
    "LBZ": {"EUS": 35},              # Leighton Buzzard

    # === Chiltern (MYB) ===
    "BCT": {"MYB": 45},              # Bicester North
    "HRW": {"MYB": 12},              # Harrow-on-the-Hill
    "AGT": {"MYB": 58},              # Aylesbury
    "HPD": {"MYB": 30},              # High Wycombe
    "BKM": {"MYB": 23},              # Beaconsfield
    "GER": {"MYB": 20},              # Gerrards Cross
}

LONDON_TERMINI = {
    "KGX": "King's Cross",
    "PAD": "Paddington",
    "WAT": "Waterloo",
    "VIC": "Victoria",
    "LST": "Liverpool Street",
    "BFR": "Blackfriars",
    "CST": "Cannon Street",
    "CHX": "Charing Cross",
    "EUS": "Euston",
    "MYB": "Marylebone",
    "STP": "St Pancras International",
}


def generate_journey_times_for_terminus(
    terminus_crs: str,
    stations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Generate journey time entries for all stations to a given terminus."""
    results = []
    for station in stations:
        crs = station["crs"]
        times = STATION_TERMINUS_TIMES.get(crs, {})
        jm = times.get(terminus_crs)

        results.append({
            "remote_crs": crs,
            "terminus_crs": terminus_crs,
            "journey_minutes": jm,
            "changes": 0,
            "remote_name": station["name"],
            "remote_lat": station["lat"],
            "remote_lon": station["lon"],
        })
    return results


def main():
    stations_path = Path(__file__).parent / "stations.json"
    data_dir = Path(__file__).parent.parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    with open(stations_path) as f:
        stations = json.load(f)

    print(f"Loaded {len(stations)} stations")

    for terminus_crs, terminus_name in LONDON_TERMINI.items():
        results = generate_journey_times_for_terminus(terminus_crs, stations)
        reachable = sum(1 for r in results if r["journey_minutes"] is not None)

        output_path = data_dir / f"journey_times_{terminus_crs}.json"
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)

        print(f"{terminus_crs} ({terminus_name}): {reachable}/{len(stations)} reachable")

    # Also update checkpoint
    checkpoint = {
        "fetched_termini": list(LONDON_TERMINI.keys()),
        "computed": [],
    }
    with open(data_dir / "checkpoint.json", "w") as f:
        json.dump(checkpoint, f, indent=2)
    print("\nCheckpoint updated — all termini marked as fetched.")

    # Summary
    all_mapped = set()
    for crs, times in STATION_TERMINUS_TIMES.items():
        all_mapped.add(crs)
    station_crs = {s["crs"] for s in stations}
    unmapped = station_crs - all_mapped
    if unmapped:
        print(f"\nWarning: {len(unmapped)} stations have no journey times: {sorted(unmapped)}")


if __name__ == "__main__":
    main()
