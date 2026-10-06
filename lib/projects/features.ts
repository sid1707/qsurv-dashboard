/** Analysis features a nodal lab switches on at onboarding (columns on projects). */
export const PROJECT_FEATURES = ["data_management", "data_compilation", "data_plotting"] as const
export type ProjectFeature = (typeof PROJECT_FEATURES)[number]
export type ProjectFeatures = Record<ProjectFeature, boolean>

export const FEATURE_LABELS: Record<ProjectFeature, string> = {
  data_management: "Data management",
  data_compilation: "Data compilation",
  data_plotting: "Data plotting",
}

export function featuresOf(project: ProjectFeatures): ProjectFeatures {
  return {
    data_management: project.data_management === true,
    data_compilation: project.data_compilation === true,
    data_plotting: project.data_plotting === true,
  }
}

export function enabledFeatureLabels(features: ProjectFeatures) {
  return PROJECT_FEATURES.filter((f) => features[f]).map((f) => FEATURE_LABELS[f])
}

/**
 * One page in a workspace sidebar. `page` is the path under the workspace root
 * ("" is the root). A page with a feature is shown only when that feature was
 * switched on at onboarding; pages without one are always shown.
 */
export type WorkspacePage = { page: string; label: string; feature: ProjectFeature | null }

export const ADMIN_PAGES: WorkspacePage[] = [
  { page: "", label: "Overview", feature: null },
  { page: "approvals", label: "Approvals", feature: "data_management" },
  { page: "compiled", label: "Compiled data", feature: "data_compilation" },
  { page: "plots", label: "Plots", feature: "data_plotting" },
  { page: "centres", label: "Centres", feature: null },
  { page: "users", label: "Users", feature: null },
  { page: "announcements", label: "Announcements", feature: null },
  { page: "settings", label: "Settings", feature: null },
]

/** Uploads and their validation are the data management feature; plots are read-only, own centre only. */
export const CENTRE_PAGES: WorkspacePage[] = [
  { page: "upload", label: "Upload", feature: "data_management" },
  { page: "uploads", label: "My uploads", feature: "data_management" },
  { page: "validation", label: "Validation results", feature: "data_management" },
  { page: "plots", label: "Plots", feature: "data_plotting" },
  { page: "announcements", label: "Announcements", feature: null },
  { page: "profile", label: "Profile", feature: null },
]

export function visiblePages(pages: WorkspacePage[], features: ProjectFeatures) {
  return pages.filter((p) => p.feature === null || features[p.feature])
}

/** True when the page exists and its feature is on, so a typed-in URL cannot reach a hidden page. */
export function isPageEnabled(pages: WorkspacePage[], page: string, features: ProjectFeatures) {
  return visiblePages(pages, features).some((p) => p.page === page)
}
