// Shared data models for VideoTask and DesignTask.
// These are the single source of truth for form state, AI responses, and Monday API calls.
// When adding a new board, create a new empty task object and field config here.

export const emptyVideoTask = {
  taskName: "",
  department: "",
  product: "",
  deadline: null,
  platform: "",
  type: "",
  videoConcept: "",
  hook: "",
  scriptMessage: "",
  versionsNeeded: null,
  sizesNeeded: [],
  priority: "",
  dropboxLink: "",
  relevantFiles: [],
  targetAudience: "",
  requestor: [],
  editorDesigner: [],
};

export const emptyDesignTask = {
  taskName: "",
  department: "",
  productBundle: "",
  platform: "",
  websiteType: "",
  deadline: null,
  priority: "",
  amountOfVersions: null,
  conceptIdea: "",
  supportingText: "",
  sizes: [],
  otherSizes: "",
  relevantFiles: [],
  howDidYouCreate: "",
  dropbox: "",
  requestor: [],
  editorDesigner: [],
};

// Dropdown options for Video board
export const videoOptions = {
  department: ["Socials", "Website", "Special Project", "Retention", "Creative", "Marketing/Media", "Branding", "TV", "Amazon", "Ulta"],
  product: [
    "Face Cream", "Body Wash", "Shampoo", "Conditioner", "Gift Bundles", "Body Lotion",
    "Face Serum", "Eye Cream", "Toner", "Cleanser", "Sunscreen", "Hair Mask",
    "Body Scrub", "Lip Balm", "Hand Cream", "Foot Cream", "Beard Oil", "Face Mask",
    "Vitamin C Serum", "Retinol Cream", "Hyaluronic Acid", "Niacinamide Serum",
    "Power Shower Set", "Starter Kit", "Glow Bundle", "Hydration Bundle",
    "Anti-Aging Bundle", "Other",
  ],
  platform: ["Meta", "GT | Meta", "Applovin", "Youtube | Google", "GIF | Meta"],
  type: [
    "Iterations/Cuts", "GIF Static", "Miscellaneous", "Collection",
    "Motion Design", "Translation", "Special Project", "AI Project",
    "UGC/Creator", "Script", "Long Form",
  ],
  sizesNeeded: ["16x9", "4x5", "9x16", "1x1", "Other"],
  priority: ["Low", "Medium", "High", "Critical ⚠️"],
};

// Dropdown options for Design board
export const designOptions = {
  department: [
    "Email", "Marketing", "Socials", "Projects", "GT", "Default",
    "Adge Data", "TV", "Branding", "Products & Packaging",
    "Amazon", "Creative", "GIF Design", "Website", "Ulta",
  ],
  productBundle: [
    "Power Shower Set", "Face Cream", "Shampoo", "Conditioner", "Gift Bundles",
    "Body Wash", "Body Lotion", "Face Serum", "Eye Cream", "Toner", "Cleanser",
    "Sunscreen", "Hair Mask", "Body Scrub", "Lip Balm", "Hand Cream", "Foot Cream",
    "Beard Oil", "Face Mask", "Vitamin C Serum", "Retinol Cream", "Other",
  ],
  platform: ["Meta", "Google", "Applovin", "Newsletter", "GT - Meta", "Other"],
  websiteType: ["PDP", "LP", "Other"],
  sizes: ["16x9", "4x5", "1x1", "9x16", "Other", "916x1144", "2000x2000"],
  priority: ["Low", "Medium", "High", "Critical ⚠️"],
  howDidYouCreate: ["Adge", "Upspring", "Motion", "ChatGPT"],
};
