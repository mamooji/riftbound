/**
 * Central catalog of Set 1 card ids referenced by the engine's hardcoded logic.
 *
 * Every card whose behaviour is scripted somewhere (a spell effect, a trigger, an activated
 * ability, a cost modifier) is named here ONCE, so a given id string lives in exactly one place
 * and the same constant can be shared across files instead of being re-declared per module. Token
 * ids stay in `tokens.ts` alongside their full CardDefs, since those aren't catalog cards.
 *
 * Grouped by role for readability; the grouping is documentation only — nothing depends on it.
 */

// --- Legends ----------------------------------------------------------------------------------
export const KAI_SA = "ogn-247-298";
export const VOLIBEAR = "ogn-249-298";
export const JINX = "ogn-251-298";
export const DARIUS = "ogn-253-298";
export const AHRI = "ogn-255-298";
export const LEE_SIN_LEGEND = "ogn-257-298";
export const YASUO = "ogn-259-298";
export const LEONA = "ogn-261-298";
export const TEEMO = "ogn-263-298";
export const VIKTOR_LEGEND = "ogn-265-298";
export const MISS_FORTUNE = "ogn-267-298";
export const SETT = "ogn-269-298";
export const ANNIE_STARTER = "ogs-017-024";
export const MASTER_YI_STARTER = "ogs-019-024";
export const LUX_STARTER = "ogs-021-024";
export const GAREN_STARTER = "ogs-023-024";

// --- Seals (one activated "Add a rune" ability per domain) ------------------------------------
export const SEAL_OF_RAGE = "ogn-040-298"; // fury
export const SEAL_OF_FOCUS = "ogn-081-298"; // calm
export const SEAL_OF_INSIGHT = "ogn-120-298"; // mind
export const SEAL_OF_STRENGTH = "ogn-163-298"; // body
export const SEAL_OF_DISCORD = "ogn-204-298"; // chaos
export const SEAL_OF_UNITY = "ogn-245-298"; // order

// --- Units, gear & champions with scripted behaviour ------------------------------------------
export const TEEMO_SCOUT = "ogn-197-298";
export const BLASTCONE_FAE = "ogn-097-298";
export const PIT_ROOKIE = "ogn-136-298";
export const CITHRIA = "ogn-139-298";
export const SPIRITS_REFUGE = "ogn-063-298";
export const WILDCLAW_SHAMAN = "ogn-147-298";
export const DANGEROUS_DUO = "ogn-016-298";
export const SCRAPYARD_CHAMPION = "ogn-020-298";
export const TRIFARIAN_GLORYSEEKER = "ogn-217-298";
export const DARIUS_EXECUTIONER = "ogn-243-298";
export const VANGUARD_CAPTAIN = "ogn-218-298";
export const FAITHFUL_MANUFACTOR = "ogn-211-298";
export const FORGE_OF_THE_FUTURE = "ogn-212-298";
export const NOXIAN_DRUMMER = "ogn-222-298";
export const MACHINE_EVANGEL = "ogn-239-298";
export const WATCHFUL_SENTRY = "ogn-096-298";
export const SOLARI_SHIELDBEARER = "ogn-051-298";
export const JEWELED_COLOSSUS = "ogn-086-298";
export const GEMCRAFT_SEER = "ogn-100-298";
export const MYSTIC_PORO = "ogn-171-298";
export const SAI_SCOUT = "ogn-174-298";
export const KINKOU_MONK = "ogn-141-298";
export const UNDERCOVER_AGENT = "ogn-178-298";
export const ECLIPSE_HERALD = "ogn-059-298";
export const SOLARI_SHRINE = "ogn-072-298";
export const TASTY_FAEFOLK = "ogn-075-298";
export const SOARING_SCOUT = "ogn-216-298";
export const EKKO_RECURRENT = "ogn-110-298";
export const KOG_MAW = "ogn-190-298";
export const KARMA = "ogn-235-298";
export const KARTHUS_ETERNAL = "ogn-236-298";
export const LEE_SIN_ASCETIC = "ogn-078-298";
export const ARENA_BAR = "ogn-124-298";
export const SUN_DISC = "ogn-021-298";
export const NOXUS_HOPEFUL = "ogn-012-298";
export const RHASA_THE_SUNDERER = "ogn-195-298";

// --- Spells -----------------------------------------------------------------------------------
export const FALLING_STAR = "ogn-029-298";
export const CHARM = "ogn-043-298";
export const REINFORCE = "ogn-062-298";
export const SINGULARITY = "ogn-105-298";
export const PROGRESS_DAY = "ogn-114-298";
export const TIME_WARP = "ogn-122-298";
export const UNCHECKED_POWER = "ogn-123-298";
export const MOBILIZE = "ogn-134-298";
export const CATALYST_OF_AEONS = "ogn-138-298";
export const SABOTAGE = "ogn-156-298";
export const FADING_MEMORIES = "ogn-180-298";
export const WHIRLWIND = "ogn-187-298";
export const THE_HARROWING = "ogn-198-298";
export const INVERT_TIMELINES = "ogn-201-298";
export const CULL_THE_WEAK = "ogn-209-298";
export const VENGEANCE = "ogn-229-298";
export const KINGS_EDICT = "ogn-237-298";
export const ICATHIAN_RAIN = "ogn-248-298";
export const STORMBRINGER = "ogn-250-298";
export const SUPER_MEGA_DEATH_ROCKET = "ogn-252-298";
export const SHOWSTOPPER = "ogn-270-298";
export const FIRESTORM = "ogs-002-024";
export const INCINERATE = "ogs-003-024";
export const HEXTECH_RAY = "ogn-009-298";
export const PRIMAL_STRENGTH = "ogn-154-298";
export const CLEAVE = "ogn-004-298";
export const DISINTEGRATE = "ogn-005-298";
export const SKY_SPLITTER = "ogn-014-298";
export const VOID_SEEKER = "ogn-024-298";
export const FALLING_COMET = "ogn-085-298";
export const BLAST_OF_POWER = "ogs-012-024";
export const FINAL_SPARK = "ogs-022-024";
export const RUNE_PRISON = "ogn-050-298";
export const EN_GARDE = "ogn-046-298";
export const DISCIPLINE = "ogn-058-298";
export const WIND_WALL = "ogn-064-298";
export const DEFY = "ogn-045-298";
export const MYSTIC_REVERSAL = "ogn-080-298";
export const UNYIELDING_SPIRIT = "ogn-145-298";
export const CONSULT_THE_PAST = "ogn-083-298";
export const HIDDEN_BLADE = "ogn-213-298";
export const FIGHT_OR_FLIGHT = "ogn-168-298";
export const BLOCK = "ogn-057-298";
export const SPRITE_CALL = "ogn-094-298";
export const SMOKE_SCREEN = "ogn-093-298";
export const STUPEFY = "ogn-095-298";
export const LAST_STAND = "ogn-069-298";
export const RETREAT = "ogn-104-298";
export const GUST = "ogn-169-298";
export const REBUKE = "ogn-172-298";
export const PORTAL_RESCUE = "ogn-102-298";
export const POSSESSION = "ogn-203-298";
export const CHALLENGE = "ogn-128-298";
export const GENTLEMENS_DUEL = "ogs-008-024";
export const BACK_TO_BACK = "ogn-206-298";
export const CONVERGENT_MUTATION = "ogn-108-298";
export const FACEBREAKER = "ogn-220-298";
export const ZENITH_BLADE = "ogn-262-298";
export const LAST_BREATH = "ogn-260-298";
export const SHAKEDOWN = "ogn-033-298";
export const SIPHON_POWER = "ogn-266-298";
export const CANNON_BARRAGE = "ogn-127-298";
export const FLURRY_OF_BLADES = "ogn-133-298";
export const GET_EXCITED = "ogn-008-298";
export const BLIND_FURY = "ogn-025-298";
export const STACKED_DECK = "ogn-183-298";
export const THERMO_BEAM = "ogn-022-298";
export const GRAND_STRATEGEM = "ogn-233-298";
export const DECISIVE_STRIKE = "ogs-024-024";
export const SALVAGE = "ogn-224-298";
export const ACCEPTABLE_LOSSES = "ogn-179-298";
export const MEDITATION = "ogn-048-298";
