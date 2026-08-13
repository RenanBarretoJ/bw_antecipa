export function isSidebarItemActive(pathname: string, href: string, role: string) {
  const currentPathname = pathname.split(/[?#]/, 1)[0]

  if (href === '/admin') {
    return currentPathname === href
  }

  return currentPathname === href
    || (href !== `/${role}/dashboard` && currentPathname.startsWith(`${href}/`))
}
