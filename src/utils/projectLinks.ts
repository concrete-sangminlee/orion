import { bugs, homepage, repository } from '../../package.json'

/** Browser URL for a package.json repository url ("git+https://host/o/r.git" -> "https://host/o/r"). */
export function repositoryWebUrl(url: string): string {
  return url.replace(/^git\+/, '').replace(/\.git$/, '')
}

const REPOSITORY = repositoryWebUrl(repository.url)

/**
 * The project's public links, derived from package.json (the same repository
 * the native Help menu opens) so in-app links cannot point somewhere else.
 */
export const PROJECT_LINKS = {
  repository: REPOSITORY,
  readme: homepage,
  issues: bugs.url,
  releases: `${REPOSITORY}/releases`,
  license: `${REPOSITORY}/blob/main/LICENSE`,
} as const
