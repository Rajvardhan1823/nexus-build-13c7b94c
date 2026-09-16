export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          role: string
          tool_trace: Json | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          role: string
          tool_trace?: Json | null
          user_id?: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          role?: string
          tool_trace?: Json | null
          user_id?: string
        }
        Relationships: []
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          kind: string
          payload: Json
          result: Json | null
          started_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          payload?: Json
          result?: Json | null
          started_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      listing_changes: {
        Row: {
          change_type: string
          details: Json
          detected_at: string
          id: string
          listing_id: string
        }
        Insert: {
          change_type: string
          details?: Json
          detected_at?: string
          id?: string
          listing_id: string
        }
        Update: {
          change_type?: string
          details?: Json
          detected_at?: string
          id?: string
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_changes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          apply_url: string | null
          company: string | null
          created_at: string
          deadline: string | null
          description: string | null
          embedding: string | null
          experience_level: string | null
          extraction_error: string | null
          extraction_status: string
          id: string
          is_active: boolean
          location: string | null
          raw_listing_id: string
          raw_response: string | null
          remote_ok: boolean | null
          required_skills: string[]
          source: string
          source_url: string
          stipend: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          apply_url?: string | null
          company?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          embedding?: string | null
          experience_level?: string | null
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          is_active?: boolean
          location?: string | null
          raw_listing_id: string
          raw_response?: string | null
          remote_ok?: boolean | null
          required_skills?: string[]
          source: string
          source_url: string
          stipend?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          apply_url?: string | null
          company?: string | null
          created_at?: string
          deadline?: string | null
          description?: string | null
          embedding?: string | null
          experience_level?: string | null
          extraction_error?: string | null
          extraction_status?: string
          id?: string
          is_active?: boolean
          location?: string | null
          raw_listing_id?: string
          raw_response?: string | null
          remote_ok?: boolean | null
          required_skills?: string[]
          source?: string
          source_url?: string
          stipend?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_raw_listing_id_fkey"
            columns: ["raw_listing_id"]
            isOneToOne: true
            referencedRelation: "raw_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      llm_calls: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          model: string | null
          ok: boolean
          task: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          model?: string | null
          ok?: boolean
          task: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          model?: string | null
          ok?: boolean
          task?: string
          user_id?: string | null
        }
        Relationships: []
      }
      matches: {
        Row: {
          created_at: string
          id: string
          justification: string | null
          listing_id: string
          resume_id: string
          score: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          justification?: string | null
          listing_id: string
          resume_id: string
          score: number
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          justification?: string | null
          listing_id?: string
          resume_id?: string
          score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_resume_id_fkey"
            columns: ["resume_id"]
            isOneToOne: false
            referencedRelation: "resumes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      raw_listings: {
        Row: {
          content_hash: string
          id: string
          is_active: boolean
          last_seen_at: string
          raw_text: string
          scraped_at: string
          source: string
          source_listing_id: string | null
          source_url: string
        }
        Insert: {
          content_hash: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          raw_text: string
          scraped_at?: string
          source: string
          source_listing_id?: string | null
          source_url: string
        }
        Update: {
          content_hash?: string
          id?: string
          is_active?: boolean
          last_seen_at?: string
          raw_text?: string
          scraped_at?: string
          source?: string
          source_listing_id?: string | null
          source_url?: string
        }
        Relationships: []
      }
      resumes: {
        Row: {
          char_count: number
          created_at: string
          embedding: string | null
          filename: string | null
          id: string
          is_active: boolean
          raw_text: string
          skills: string[]
          user_id: string
        }
        Insert: {
          char_count?: number
          created_at?: string
          embedding?: string | null
          filename?: string | null
          id?: string
          is_active?: boolean
          raw_text: string
          skills?: string[]
          user_id?: string
        }
        Update: {
          char_count?: number
          created_at?: string
          embedding?: string | null
          filename?: string | null
          id?: string
          is_active?: boolean
          raw_text?: string
          skills?: string[]
          user_id?: string
        }
        Relationships: []
      }
      shortlist: {
        Row: {
          created_at: string
          id: string
          listing_id: string
          note: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          listing_id: string
          note?: string | null
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          listing_id?: string
          note?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shortlist_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_listings: {
        Args: {
          match_count?: number
          min_similarity?: number
          query_embedding: string
        }
        Returns: {
          apply_url: string
          company: string
          deadline: string
          description: string
          experience_level: string
          id: string
          location: string
          remote_ok: boolean
          required_skills: string[]
          similarity: number
          source: string
          source_url: string
          stipend: string
          title: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
