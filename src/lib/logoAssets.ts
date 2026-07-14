// Bundled insurance logo set (design doc §4.3): insurance groups and secondary
// coverages reference these by asset key; the set is compiled into the exe, so
// new artwork requires a new build. Keys are what the DB stores.
import aetna from "../assets/insurance-logos/aetna.svg";
import amerihealth from "../assets/insurance-logos/amerihealth.svg";
import bcbs from "../assets/insurance-logos/bcbs.svg";
import cignaGroup from "../assets/insurance-logos/cigna-group.svg";
import cms from "../assets/insurance-logos/cms.svg";
import coupon from "../assets/insurance-logos/coupon.svg";
import cvsHealth from "../assets/insurance-logos/cvs-health.svg";
import elevanceHealth from "../assets/insurance-logos/elevance-health.svg";
import medimpact from "../assets/insurance-logos/medimpact.svg";
import molinaHealthcare from "../assets/insurance-logos/molina-healthcare.svg";
import oscarHealth from "../assets/insurance-logos/oscar-health.svg";
import unitedhealthGroup from "../assets/insurance-logos/unitedhealth-group.svg";

export interface LogoAsset {
  label: string;
  url: string;
}

export const LOGO_ASSETS: Record<string, LogoAsset> = {
  bcbs: { label: "Blue Cross Blue Shield", url: bcbs },
  "cvs-health": { label: "CVS Health", url: cvsHealth },
  "elevance-health": { label: "Elevance Health", url: elevanceHealth },
  "unitedhealth-group": { label: "UnitedHealth Group", url: unitedhealthGroup },
  "cigna-group": { label: "The Cigna Group", url: cignaGroup },
  "oscar-health": { label: "Oscar Health", url: oscarHealth },
  medimpact: { label: "MedImpact", url: medimpact },
  "molina-healthcare": { label: "Molina Healthcare", url: molinaHealthcare },
  amerihealth: { label: "AmeriHealth Caritas", url: amerihealth },
  coupon: { label: "Coupon", url: coupon },
  aetna: { label: "Aetna", url: aetna },
  cms: { label: "Medicare / Medicaid (CMS)", url: cms },
};

export function logoUrl(key: string | null | undefined): string | undefined {
  return key ? LOGO_ASSETS[key]?.url : undefined;
}
