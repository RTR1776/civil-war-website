/**
 * Documented aftermath content for the epilogue. Figures follow the totals
 * most commonly cited in the battle studies already referenced by the
 * scenario's source list (Jacobson 2006; Cunningham 2012).
 */

export interface FallenGeneral {
  name: string;
  rank: string;
  command: string;
  fate: string;
}

export const FALLEN_GENERALS: FallenGeneral[] = [
  {
    name: "Patrick R. Cleburne",
    rank: "Major General",
    command: "Cleburne's Division, Cheatham's Corps",
    fate: "Killed leading his division against the works near the Carter cotton gin.",
  },
  {
    name: "John Adams",
    rank: "Brigadier General",
    command: "Adams' Brigade, Loring's Division",
    fate: "Killed at the parapet; his horse fell astride the Federal works.",
  },
  {
    name: "States Rights Gist",
    rank: "Brigadier General",
    command: "Gist's Brigade, Brown's Division",
    fate: "Shot from his horse leading his brigade forward, and died that night.",
  },
  {
    name: "Hiram B. Granbury",
    rank: "Brigadier General",
    command: "Granbury's Texas Brigade, Cleburne's Division",
    fate: "Killed instantly on the Columbia Pike front within yards of the works.",
  },
  {
    name: "Otho F. Strahl",
    rank: "Brigadier General",
    command: "Strahl's Brigade, Brown's Division",
    fate: "Killed in the ditch of the works while passing loaded rifles to his men.",
  },
  {
    name: "John C. Carter",
    rank: "Brigadier General",
    command: "Carter's Brigade, Brown's Division",
    fate: "Mortally wounded in the assault; died ten days later.",
  },
];

export interface CasualtyRecord {
  side: string;
  engaged: string;
  total: number;
  killed: number;
  wounded: number;
  missing: number;
}

export const DOCUMENTED_CASUALTIES: CasualtyRecord[] = [
  {
    side: "Confederate — Army of Tennessee",
    engaged: "~20,000 in the assault",
    total: 6252,
    killed: 1750,
    wounded: 3800,
    missing: 702,
  },
  {
    side: "Union — IV & XXIII Corps",
    engaged: "~27,000 on the field",
    total: 2326,
    killed: 189,
    wounded: 1033,
    missing: 1104,
  },
];

export const EPILOGUE_NOTES: string[] = [
  "Roughly five hours of fighting — much of it after dark — produced more Confederate dead than the two-day battles of Shiloh or Stones River.",
  "Fourteen Confederate general officers were casualties: six killed or mortally wounded, seven wounded, one captured. Some fifty-five regimental commanders fell with them.",
  "Schofield's army withdrew across the Harpeth during the night, intact. Two weeks later the Army of Tennessee was broken at Nashville and never fought as an army again.",
];

export const EPILOGUE_SOURCE_IDS = ["source-jacobs-2006", "source-cunningham-2012"];
