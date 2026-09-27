export type ProjectId = "cahillclub" | "dragonbot";

export interface ProjectTag {
  label: string;
  /** Chakra color palette used for the tag tint. */
  color: string;
}

export interface ProjectFeature {
  /** File name (without extension) in /public/emojis. */
  emoji: string;
  name: string;
  desc: string;
}

export interface Project {
  id: ProjectId;
  name: string;
  subtitle: string;
  href: string;
  logo: string;
  /** "cover" for logos that fill their square, "contain" for round seals on transparency. */
  logoFit: "cover" | "contain";
  sections: { title: string; body: string }[];
  tagGroups: { title: string; tags: ProjectTag[] }[];
  stats?: { label: string; value: string }[];
  links: { label: string; href: string }[];
  features?: ProjectFeature[];
}

export const PROJECTS: Project[] = [
  {
    id: "cahillclub",
    name: "Cahill Club",
    subtitle: "CahillClub.com",
    href: "/projects/cahillclub",
    logo: "/cahillclub.png",
    logoFit: "contain",
    sections: [
      {
        title: "About",
        body: "Founded in 1897, the Cahill Club is the fraternal organization of Roman Catholic High School. The club is dedicated to the promotion of the welfare of the school and the fostering of the spirit of brotherhood among its members. The club is open to any former student and alumni of Roman Catholic High School.",
      },
      {
        title: "CahillClub.com",
        body: "The Cahill Club members portal allows members to connect, view upcoming events, and more. The website is built using Next.js, Chakra UI, Supabase, and hosted on Vercel.",
      },
    ],
    tagGroups: [
      {
        title: "Technologies Used",
        tags: [
          { label: "Node.js", color: "blue" },
          { label: "Next.js", color: "green" },
          { label: "Supabase", color: "teal" },
          { label: "Chakra UI", color: "yellow" },
          { label: "Vercel", color: "purple" },
        ],
      },
    ],
    stats: [{ label: "Users", value: "6,500+" }],
    links: [{ label: "Website", href: "https://cahillclub.com" }],
  },
  {
    id: "dragonbot",
    name: "DragonBot",
    subtitle: "DragonBot#5561",
    href: "/projects/dragonbot",
    logo: "/dragonbot.png",
    logoFit: "cover",
    sections: [
      {
        title: "About",
        body: "DragonBot is a Discord bot built for Drexel University communities, featuring email verification, moderation tools, user profiles, AI Q&A, XP/leveling, polls, suggestions, YouTube notifications, scheduled messages, birthday tracking, audit logging, and a full web dashboard.",
      },
    ],
    tagGroups: [
      {
        title: "Technologies Used",
        tags: [
          { label: "TypeScript", color: "blue" },
          { label: "Discord.js", color: "green" },
          { label: "Next.js", color: "cyan" },
          { label: "PostgreSQL", color: "purple" },
          { label: "Drizzle ORM", color: "orange" },
          { label: "Tailwind CSS", color: "teal" },
          { label: "OpenAI", color: "yellow" },
          { label: "Turborepo", color: "red" },
        ],
      },
      {
        title: "Deployment",
        tags: [
          { label: "Railway (Bot)", color: "purple" },
          { label: "Vercel (Web)", color: "blue" },
          { label: "Neon (Database)", color: "green" },
        ],
      },
    ],
    links: [
      { label: "Discord", href: "https://discord.gg/KCkj4CeMtD" },
      { label: "GitHub", href: "https://github.com/drexelDiscord/dragonbot" },
    ],
    features: [
      { emoji: "checkmark", name: "Email Verification", desc: "Verify Drexel students with @drexel.edu emails, with cross-server sync across all DragonBot guilds" },
      { emoji: "judge", name: "Ban Sync", desc: "Automatically propagate bans across all servers with ban sync enabled" },
      { emoji: "cool", name: "User Profiles", desc: "Shareable profiles with name, pronouns, major, college, year, plan, co-ops, clubs, and more" },
      { emoji: "robot", name: "AI Q&A", desc: "AI powered /ask command with per-server custom system prompts" },
      { emoji: "bar-chart", name: "XP & Leveling", desc: "XP system with in-memory caching, leaderboards, level-up announcements, and archive/restore" },
      { emoji: "light-bulb", name: "Suggestions", desc: "Community feature requests with status tracking and web dashboard management" },
      { emoji: "checkmark", name: "Polls", desc: "Reaction-based polls with up to 20 options and custom emoji support" },
      { emoji: "television", name: "YouTube Notifications", desc: "Upload alerts for subscribed YouTube channels with custom messages" },
      { emoji: "birthday-cake", name: "Birthday Tracking", desc: "Set birthdays with automated per-server announcements and configurable timezone support" },
      { emoji: "clock", name: "Scheduled Messages", desc: "Automated recurring messages with cron scheduling, timezone support, and embed customization" },
      { emoji: "globe-with-meridians", name: "Web Dashboard", desc: "Full-featured dashboard to manage server settings, profiles, schedules, suggestions, and YouTube subscriptions" },
      { emoji: "scroll", name: "Audit Logging", desc: "Log embeds for joins, leaves, bans, kicks, message edits/deletes, role and nickname changes, and voice activity" },
      { emoji: "waving-hand", name: "Welcome", desc: "Customizable channel and DM welcome messages" },
      { emoji: "toolbox", name: "Moderation Tools", desc: "Bot announcements, mod notes, message gating, and granular guild manager permissions with 12+ delegation scopes" },
      { emoji: "party-popper", name: "Fun Commands", desc: "Dice rolls, LaTeX rendering, and more" },
    ],
  },
];

export const getProject = (id: ProjectId) => PROJECTS.find((p) => p.id === id)!;
