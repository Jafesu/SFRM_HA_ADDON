"""Game rules the planner needs that FRM doesn't report.

Everything else (recipes, rates, what's unlocked, build costs, resource nodes)
comes from the live save through FRM.
"""

from __future__ import annotations

from typing import Final

# Power use in MW at 100 % clock. Buildings with variable power use their average.
BUILDING_POWER: Final[dict[str, float]] = {
    "Build_SmelterMk1_C": 4,
    "Build_ConstructorMk1_C": 4,
    "Build_AssemblerMk1_C": 15,
    "Build_FoundryMk1_C": 16,
    "Build_ManufacturerMk1_C": 55,
    "Build_OilRefinery_C": 30,
    "Build_Packager_C": 10,
    "Build_Blender_C": 75,
    "Build_HadronCollider_C": 500,  # particle accelerator, 250-750 MW
    "Build_Converter_C": 250,  # 100-400 MW
    "Build_QuantumEncoder_C": 1000,  # 0-2000 MW
    "Build_MinerMk1_C": 5,
    "Build_MinerMk2_C": 15,
    "Build_MinerMk3_C": 45,
    "Build_WaterPump_C": 20,
    "Build_OilPump_C": 40,
    "Build_FrackingExtractor_C": 0,  # satellites draw no power; the activator does
    "Build_FrackingSmasher_C": 150,
}
# Power scales with clock speed to this exponent (1.6 update and later).
CLOCK_POWER_EXPONENT: Final = 1.321928

# Extractors: items/min (or m³/min) from a Normal node at 100 % clock.
PURITY_FACTOR: Final[dict[str, float]] = {"Impure": 0.5, "Normal": 1.0, "Pure": 2.0}
MINER_RATE: Final[dict[str, float]] = {
    "Build_MinerMk1_C": 60,
    "Build_MinerMk2_C": 120,
    "Build_MinerMk3_C": 240,
}
WATER_EXTRACTOR_RATE: Final = 120  # not affected by purity
OIL_EXTRACTOR_RATE: Final = 120
WELL_SATELLITE_RATE: Final = 60  # resource well extractor on a Normal satellite

# Transport capacity per minute.
BELT_SPEEDS: Final[dict[str, float]] = {
    "Build_ConveyorBeltMk1_C": 60,
    "Build_ConveyorBeltMk2_C": 120,
    "Build_ConveyorBeltMk3_C": 270,
    "Build_ConveyorBeltMk4_C": 480,
    "Build_ConveyorBeltMk5_C": 780,
    "Build_ConveyorBeltMk6_C": 1200,
}
PIPE_SPEEDS: Final[dict[str, float]] = {
    "Build_Pipeline_C": 300,
    "Build_PipelineMK2_C": 600,
}

FLUIDS: Final = frozenset({
    "Desc_Water_C",
    "Desc_LiquidOil_C",
    "Desc_HeavyOilResidue_C",
    "Desc_LiquidFuel_C",
    "Desc_LiquidTurboFuel_C",
    "Desc_LiquidBiofuel_C",
    "Desc_AluminaSolution_C",
    "Desc_SulfuricAcid_C",
    "Desc_NitricAcid_C",
    "Desc_NitrogenGas_C",
    "Desc_RocketFuel_C",
    "Desc_IonizedFuel_C",
    "Desc_DissolvedSilica_C",
    "Desc_QuantumEnergy_C",
    "Desc_DarkEnergy_C",
})

# Raw resources: what the extractor needs and which node names supply them.
# Water also comes from water extractors anywhere on water (unlimited).
RAW_RESOURCES: Final[dict[str, str]] = {
    "Desc_OreIron_C": "miner",
    "Desc_OreCopper_C": "miner",
    "Desc_Stone_C": "miner",
    "Desc_Coal_C": "miner",
    "Desc_OreGold_C": "miner",
    "Desc_RawQuartz_C": "miner",
    "Desc_Sulfur_C": "miner",
    "Desc_OreBauxite_C": "miner",
    "Desc_OreUranium_C": "miner",
    "Desc_SAM_C": "miner",
    "Desc_LiquidOil_C": "oil",
    "Desc_NitrogenGas_C": "well",
    "Desc_Water_C": "water",
}
# Relative cost of using a resource when nothing else limits it (water is free-ish).
UNLIMITED_RESOURCES: Final = frozenset({"Desc_Water_C"})
