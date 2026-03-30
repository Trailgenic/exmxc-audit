// /shared/ads-taxonomy.js
// ADS (AI Deployment Signal) tier taxonomy and helper signals

export const TIER_KEYWORDS = {
  t1_awareness: {
    roles: [
      "ai strategy",
      "digital transformation",
      "ai literacy",
      "innovation manager",
      "emerging tech",
      "ai council",
      "ai policy"
    ],
    skills: [
      "prompt engineering",
      "chatgpt",
      "copilot",
      "ai tools",
      "generative ai awareness",
      "responsible ai",
      "ai governance"
    ]
  },
  t2_experimentation: {
    roles: ["ai product manager", "ml analyst", "data scientist", "ai researcher"],
    skills: [
      "fine-tuning",
      "llm evaluation",
      "rag",
      "vector database",
      "embeddings",
      "langchain",
      "openai api",
      "retrieval augmented"
    ]
  },
  t3_integration: {
    roles: [
      "ml engineer",
      "ai engineer",
      "llm engineer",
      "applied ai",
      "ai platform engineer",
      "mlops",
      "llmops"
    ],
    skills: [
      "production llm",
      "llmops",
      "mlops",
      "model deployment",
      "inference optimization",
      "ai pipelines",
      "semantic search",
      "model serving",
      "sagemaker",
      "vertex ai",
      "azure ml",
      "hugging face"
    ]
  },
  t4_agentic: {
    roles: [
      "ai agent engineer",
      "agentic systems",
      "autonomous systems",
      "ai workflow architect",
      "multi-agent"
    ],
    skills: [
      "ai agents",
      "agentic workflows",
      "tool use",
      "function calling",
      "autogen",
      "crewai",
      "langgraph",
      "phidata",
      "agent orchestration",
      "multi-agent",
      "memory systems"
    ]
  },
  t4_mcp: {
    roles: ["mcp engineer", "model context protocol"],
    skills: ["mcp", "model context protocol", "mcp server", "mcp endpoint"],
    weightMultiplier: 1.5
  },
  t5_sovereign: {
    roles: [
      "foundation model engineer",
      "ai research scientist",
      "principal ai engineer",
      "head of ai infrastructure"
    ],
    skills: [
      "foundation model",
      "pre-training",
      "rlhf",
      "custom model",
      "model distillation",
      "proprietary llm",
      "distributed training"
    ]
  }
};

export const DEPLOYMENT_SIGNALS = [
  "engineer",
  "infra",
  "platform",
  "systems",
  "architect",
  "developer"
];

export const EXPLORATION_SIGNALS = [
  "strategy",
  "transformation",
  "governance",
  "policy",
  "literacy"
];

export const LEADERSHIP_SIGNALS = [
  "head of",
  "director",
  "vp ",
  "principal",
  "staff ",
  "distinguished"
];

const TIER_ORDER = [
  [5, "t5_sovereign"],
  [4, "t4_mcp"],
  [4, "t4_agentic"],
  [3, "t3_integration"],
  [2, "t2_experimentation"],
  [1, "t1_awareness"]
];

export function getTierForSkill(skill) {
  const text = String(skill || "").toLowerCase().trim();
  if (!text) return 1;

  for (const [tier, key] of TIER_ORDER) {
    const terms = TIER_KEYWORDS[key]?.skills || [];
    if (terms.some(term => text.includes(String(term).toLowerCase()))) {
      return tier;
    }
  }

  return 1;
}
