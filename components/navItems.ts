// The sidebar's pages, in its order. Icons live in Sidebar so the sitemap can import this
// without pulling in react-icons.
export const NAV_ITEMS: readonly { href: string; label: string }[] = [
  { href: "/", label: "I am" },
  { href: "/stats", label: "Statistics" },
  { href: "/bookshelf", label: "Bookshelf" },
  { href: "/snapshots", label: "Snapshots" },
  { href: "/projects", label: "Projects" },
  { href: "/blog", label: "Blog" },
  { href: "/contact", label: "Contact" },
]
