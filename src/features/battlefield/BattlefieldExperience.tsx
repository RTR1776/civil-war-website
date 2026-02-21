import BattlefieldExperienceLegacy from "@/features/battlefield/BattlefieldExperienceLegacy";
import BattlefieldExperienceV2 from "@/features/battlefield/BattlefieldExperienceV2";

const ENABLE_EXPERIENCE_V2 =
  process.env.NEXT_PUBLIC_EXPERIENCE_V2 === "1" ||
  process.env.NEXT_PUBLIC_EXPERIENCE_V2?.toLowerCase() === "true";

export default function BattlefieldExperience() {
  if (!ENABLE_EXPERIENCE_V2) {
    return <BattlefieldExperienceLegacy />;
  }

  return <BattlefieldExperienceV2 />;
}
