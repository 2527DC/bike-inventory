export interface RoleplayMessage {
  role: 'customer' | 'salesperson';
  content: string;
  timestamp: string;
}

export interface AiFeedback {
  overall_score: number;
  strengths: string[];
  improvements: string[];
  tips: string[];
}

export interface BuyerPsychology {
  emotionalTriggers: string[];
  socialNeeds: string[];
  psychologicalDrivers: string[];
  fearAndAnxiety: string[];
  dreamOutcome: string;
  buyerPersona: string;
  decisionStyle: string;
  hiddenMotivation: string;
}

export interface ProductSpecs {
  [key: string]: string;
}

export interface Competitor {
  name: string;
  brand: string;
  // Nullable, matching lmsCompetitorSchema — a competitor can be listed without a known
  // price. This said `number` until the product pages stopped casting their data through
  // `as any[]`, which was the only reason the lie survived. The UI already renders it as
  // `c.price?.toLocaleString(...)`, so it always expected null in practice.
  price: number | null;
  pros: string[];
  cons: string[];
  verdict: string;
}

export interface ProductReview {
  summary: string;
  // Nullable for the same reason as Competitor.price above — lmsReviewSchema declares
  // `z.number().min(0).max(5).nullable()`, because a quoted review often has no star rating.
  rating: number | null;
  source?: string;
}

export interface ProductReviews {
  best: ProductReview[];
  worst: ProductReview[];
}

export interface ProductSource {
  title: string;
  url: string;
}

export interface ProductFaq {
  question: string;
  answer: string;
}

export interface LmsProduct {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number | null;
  image_url: string | null;
  usps: string[];
  features: string[];
  talking_points: string[];
  target_customer: string | null;
  common_objections: { objection: string; response: string }[];
  buyer_psychology: BuyerPsychology | null;
  unique_fact: string | null;
  specs: ProductSpecs;
  competitors: Competitor[];
  reviews: ProductReviews;
  sources: ProductSource[];
  faqs: ProductFaq[];
  is_active: boolean;
  created_at: string;
}

export interface Scenario {
  id: string;
  title: string;
  type: 'walk-in' | 'phone' | 'repeat' | 'festival' | 'parent' | 'comparison' | 'service-upsell';
  description: string | null;
  checklist: ChecklistItem[];
  tips: string[];
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ChecklistItem {
  step: string;
  done: boolean;
}

export interface VideoCategory {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  created_at: string;
}

export interface Video {
  id: string;
  title: string;
  description: string | null;
  youtube_url: string;
  category_id: string | null;
  duration_minutes: number | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  category?: VideoCategory;
}

export interface Quiz {
  id: string;
  title: string;
  description: string | null;
  type: 'product' | 'scenario' | 'general' | 'objection-handling';
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  passing_score: number;
  xp_reward: number;
  is_active: boolean;
  created_at: string;
  questions?: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  quiz_id: string;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  sort_order: number;
}

export interface QuizAttempt {
  id: string;
  user_id: string;
  quiz_id: string;
  score: number;
  total: number;
  passed: boolean;
  answers: number[];
  xp_earned: number;
  completed_at: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  criteria_type: string;
  criteria_value: number;
  xp_reward: number;
  created_at: string;
}

export interface UserAchievement {
  id: string;
  user_id: string;
  achievement_id: string;
  earned_at: string;
  achievement?: Achievement;
}

export interface UserProgress {
  id: string;
  user_id: string;
  xp: number;
  level: number;
  streak_days: number;
  longest_streak: number;
  last_active_date: string;
  videos_watched: string[];
  scenarios_completed: string[];
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  activity_type: string;
  details: Record<string, unknown>;
  xp_earned: number;
  created_at: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  priority: 'normal' | 'important' | 'urgent';
  is_active: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface DailyTip {
  id: string;
  content: string;
  category: string;
  scheduled_for: string | null;
  is_active: boolean;
  created_at: string;
}
