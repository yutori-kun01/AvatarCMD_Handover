// SNS プラットフォームのアイコン（Font Awesome 7 Free）
// Zenn / note / Amebaブログ / stand.fm は Font Awesome にロゴが無いため、近いアイコンをブランドカラーで表示する。
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faBluesky, faFacebook, faInstagram, faLinkedin, faMedium, faRedditAlien, faSubstack, faThreads, faTiktok, faWordpress, faXTwitter, faYoutube,
} from "@fortawesome/free-brands-svg-icons";
import { faBlog, faBookOpen, faHashtag, faPenNib, faPodcast } from "@fortawesome/free-solid-svg-icons";

const ICONS: Record<string, { icon: IconDefinition; color: string }> = {
  x: { icon: faXTwitter, color: "#ffffff" },
  threads: { icon: faThreads, color: "#ffffff" },
  bluesky: { icon: faBluesky, color: "#1185fe" },
  instagram: { icon: faInstagram, color: "#e4405f" },
  facebook: { icon: faFacebook, color: "#1877f2" },
  linkedin: { icon: faLinkedin, color: "#0a66c2" },
  tiktok: { icon: faTiktok, color: "#ffffff" },
  youtube: { icon: faYoutube, color: "#ff0000" },
  reddit: { icon: faRedditAlien, color: "#ff4500" },
  wordpress: { icon: faWordpress, color: "#3858e9" },
  medium: { icon: faMedium, color: "#ffffff" },
  substack: { icon: faSubstack, color: "#ff6719" },
  zenn: { icon: faBookOpen, color: "#3ea8ff" },
  note: { icon: faPenNib, color: "#41c9b4" },
  ameba: { icon: faBlog, color: "#2d8c3c" },
  standfm: { icon: faPodcast, color: "#f5a623" },
};

export function PlatformIcon({ platform, className = "" }: { platform: string; className?: string }) {
  const def = ICONS[platform] ?? { icon: faHashtag, color: "rgba(255,255,255,0.6)" };
  return <FontAwesomeIcon icon={def.icon} fixedWidth style={{ color: def.color }} className={className} aria-hidden />;
}
