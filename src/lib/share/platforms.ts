// Platform preview rules live in JSON (src/rules/share/*.json) so they can be
// re-verified and updated without touching code. Each file records its
// sources and lastVerified date.
import x from '../../rules/share/x.json';
import telegram from '../../rules/share/telegram.json';
import discord from '../../rules/share/discord.json';
import whatsapp from '../../rules/share/whatsapp.json';
import facebook from '../../rules/share/facebook.json';
import linkedin from '../../rules/share/linkedin.json';
import slack from '../../rules/share/slack.json';
import imessage from '../../rules/share/imessage.json';
import google from '../../rules/share/google.json';
import bots from '../../rules/bots.json';

export type FieldToken = string;
export type ShareField = 'title' | 'description' | 'image' | 'imageAlt' | 'siteName' | 'themeColor';

export interface PlatformRule {
  platform: string;
  name: string;
  fields: Record<ShareField, FieldToken[]>;
  cardType: { tag: string; default: string } | null;
  displays: Record<'title' | 'description' | 'siteName' | 'domain' | 'image' | 'imageAlt' | 'themeColor', boolean>;
  truncate: { title?: number | null; description?: number | null; titlePx?: number; descriptionPx?: number; descriptionPxMobile?: number };
  image: {
    minWidth: number | null;
    minHeight: number | null;
    recommendedWidth: number | null;
    recommendedHeight: number | null;
    maxBytes: number | null;
    displayRatio: number | null;
    smallThumbnail: boolean;
    formats: string[];
    unsupportedFormats: string[];
  };
  debugger: { label: string; url: string } | null;
  refreshNote: string | null;
  notes: string[];
  source: string[];
  lastVerified: string;
}

export interface BotProfile {
  id: string;
  label: string;
  userAgent: string;
  source?: string;
}

export const PLATFORMS: PlatformRule[] = [x, facebook, linkedin, telegram, discord, whatsapp, slack, imessage, google] as PlatformRule[];
export const SOCIAL_PLATFORMS = PLATFORMS.filter((p) => p.platform !== 'google');
export const BOTS: BotProfile[] = (bots as { bots: BotProfile[] }).bots;

/** Crawler user agent each platform fetches with (ids from src/rules/bots.json). */
export const PLATFORM_BOT: Record<string, string> = {
  x: 'twitterbot',
  facebook: 'facebookexternalhit',
  linkedin: 'linkedinbot',
  telegram: 'telegrambot',
  discord: 'discordbot',
  whatsapp: 'whatsapp',
  slack: 'slackbot-linkexpanding',
  imessage: 'imessage',
  google: 'googlebot-smartphone',
};

export function platform(id: string): PlatformRule {
  const p = PLATFORMS.find((x) => x.platform === id);
  if (!p) throw new Error(`unknown platform ${id}`);
  return p;
}

export const FIELD_TOKENS = /^(og:[a-z_:]+|twitter:[a-z_:]+|title|meta:description|meta:theme-color|link:image_src|host|first-img)$/;
