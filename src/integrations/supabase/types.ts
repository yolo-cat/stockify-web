export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          user_id: string;
          id: number;
          name: string;
          fee_discount: number | null;
          min_fee_regular: number | null;
          min_fee_odd_lot: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          id: number;
          name: string;
          fee_discount?: number | null;
          min_fee_regular?: number | null;
          min_fee_odd_lot?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          id?: number;
          name?: string;
          fee_discount?: number | null;
          min_fee_regular?: number | null;
          min_fee_odd_lot?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      transactions: {
        Row: {
          id: number;
          user_id: string;
          stock_code: string;
          market: string;
          account_id: number;
          date: number;
          record_time: number;
          type: string;
          buy_price: number;
          buy_shares: number;
          sell_price: number;
          sell_shares: number;
          fee: number;
          tax: number;
          income: number;
          expense: number;
          cash_dividend: number;
          ex_dividend_shares: number;
          dividend_income: number;
          supplementary_nhi_fee: number;
          stock_dividend: number;
          dividend_shares: number;
          ex_rights_shares: number;
          note: string;
          capital_reduction_ratio: number;
          shares_before_reduction: number;
          shares_after_reduction: number;
          cash_returned: number;
          stock_split_ratio: number;
          shares_before_split: number;
          shares_after_split: number;
          margin_principal: number;
          margin_annual_rate: number;
          margin_lot_id: string;
          margin_repayment_lot_id: string;
          margin_repayment: number;
          margin_self_funded: number;
          margin_self_funded_overridden: boolean;
          margin_actual_interest: number;
          short_borrow_principal: number;
          short_borrow_annual_rate: number;
          short_lot_id: string;
          short_cover_lot_id: string;
          short_cover_shares: number;
          short_compensation_lot_id: string;
          short_compensation: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          stock_code: string;
          market?: string;
          account_id?: number;
          date: number;
          record_time: number;
          type: string;
          buy_price?: number;
          buy_shares?: number;
          sell_price?: number;
          sell_shares?: number;
          fee?: number;
          tax?: number;
          income?: number;
          expense?: number;
          cash_dividend?: number;
          ex_dividend_shares?: number;
          dividend_income?: number;
          supplementary_nhi_fee?: number;
          stock_dividend?: number;
          dividend_shares?: number;
          ex_rights_shares?: number;
          note?: string;
          capital_reduction_ratio?: number;
          shares_before_reduction?: number;
          shares_after_reduction?: number;
          cash_returned?: number;
          stock_split_ratio?: number;
          shares_before_split?: number;
          shares_after_split?: number;
          margin_principal?: number;
          margin_annual_rate?: number;
          margin_lot_id?: string;
          margin_repayment_lot_id?: string;
          margin_repayment?: number;
          margin_self_funded?: number;
          margin_self_funded_overridden?: boolean;
          margin_actual_interest?: number;
          short_borrow_principal?: number;
          short_borrow_annual_rate?: number;
          short_lot_id?: string;
          short_cover_lot_id?: string;
          short_cover_shares?: number;
          short_compensation_lot_id?: string;
          short_compensation?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          stock_code?: string;
          market?: string;
          account_id?: number;
          date?: number;
          record_time?: number;
          type?: string;
          buy_price?: number;
          buy_shares?: number;
          sell_price?: number;
          sell_shares?: number;
          fee?: number;
          tax?: number;
          income?: number;
          expense?: number;
          cash_dividend?: number;
          ex_dividend_shares?: number;
          dividend_income?: number;
          supplementary_nhi_fee?: number;
          stock_dividend?: number;
          dividend_shares?: number;
          ex_rights_shares?: number;
          note?: string;
          capital_reduction_ratio?: number;
          shares_before_reduction?: number;
          shares_after_reduction?: number;
          cash_returned?: number;
          stock_split_ratio?: number;
          shares_before_split?: number;
          shares_after_split?: number;
          margin_principal?: number;
          margin_annual_rate?: number;
          margin_lot_id?: string;
          margin_repayment_lot_id?: string;
          margin_repayment?: number;
          margin_self_funded?: number;
          margin_self_funded_overridden?: boolean;
          margin_actual_interest?: number;
          short_borrow_principal?: number;
          short_borrow_annual_rate?: number;
          short_lot_id?: string;
          short_cover_lot_id?: string;
          short_cover_shares?: number;
          short_compensation_lot_id?: string;
          short_compensation?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      bank_deposits: {
        Row: {
          user_id: string;
          id: number;
          name: string;
          amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          id: number;
          name: string;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          id?: number;
          name?: string;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      loans: {
        Row: {
          user_id: string;
          id: number;
          name: string;
          amount: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          id: number;
          name: string;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          id?: number;
          name?: string;
          amount?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_settings: {
        Row: {
          user_id: string;
          refresh_interval: number;
          fee_discount: number;
          min_fee_regular: number;
          min_fee_odd_lot: number;
          dividend_fee: number;
          pre_deduct_sell_fees: boolean;
          partial_sales_as_realized: boolean;
          exclude_dividend_income_from_returns: boolean;
          return_rate_mode: string;
          calculation_rounding_mode: string;
          theme: string;
          text_size_mode: string;
          stock_data_source: string;
          us_stock_data_source: string;
          notify_fallback_repeatedly: boolean;
          tax_rate_normal_listed_stock: number;
          tax_rate_domestic_stock_etf: number;
          tax_rate_bond_etf: number;
          tax_rate_day_trading: number;
          usd_to_twd_rate: number;
          home_display_mode: string;
          home_holdings_sort_mode: string;
          home_holdings_sort_column: string;
          home_holdings_sort_ascending: boolean;
          active_account_id: number;
          show_taiwan_weighted_index: boolean;
          show_taiwan_portfolio_chart: boolean;
          home_history_chart_expanded: boolean;
          detail_history_chart_expanded: boolean;
          margin_feature_enabled: boolean;
          margin_day_count: number;
          default_margin_annual_rate: number;
          default_short_borrow_annual_rate: number;
          last_update_highlights_version: string | null;
          dividend_info_cache: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          refresh_interval?: number;
          fee_discount?: number;
          min_fee_regular?: number;
          min_fee_odd_lot?: number;
          dividend_fee?: number;
          pre_deduct_sell_fees?: boolean;
          partial_sales_as_realized?: boolean;
          exclude_dividend_income_from_returns?: boolean;
          return_rate_mode?: string;
          calculation_rounding_mode?: string;
          theme?: string;
          text_size_mode?: string;
          stock_data_source?: string;
          us_stock_data_source?: string;
          notify_fallback_repeatedly?: boolean;
          tax_rate_normal_listed_stock?: number;
          tax_rate_domestic_stock_etf?: number;
          tax_rate_bond_etf?: number;
          tax_rate_day_trading?: number;
          usd_to_twd_rate?: number;
          home_display_mode?: string;
          home_holdings_sort_mode?: string;
          home_holdings_sort_column?: string;
          home_holdings_sort_ascending?: boolean;
          active_account_id?: number;
          show_taiwan_weighted_index?: boolean;
          show_taiwan_portfolio_chart?: boolean;
          home_history_chart_expanded?: boolean;
          detail_history_chart_expanded?: boolean;
          margin_feature_enabled?: boolean;
          margin_day_count?: number;
          default_margin_annual_rate?: number;
          default_short_borrow_annual_rate?: number;
          last_update_highlights_version?: string | null;
          dividend_info_cache?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          refresh_interval?: number;
          fee_discount?: number;
          min_fee_regular?: number;
          min_fee_odd_lot?: number;
          dividend_fee?: number;
          pre_deduct_sell_fees?: boolean;
          partial_sales_as_realized?: boolean;
          exclude_dividend_income_from_returns?: boolean;
          return_rate_mode?: string;
          calculation_rounding_mode?: string;
          theme?: string;
          text_size_mode?: string;
          stock_data_source?: string;
          us_stock_data_source?: string;
          notify_fallback_repeatedly?: boolean;
          tax_rate_normal_listed_stock?: number;
          tax_rate_domestic_stock_etf?: number;
          tax_rate_bond_etf?: number;
          tax_rate_day_trading?: number;
          usd_to_twd_rate?: number;
          home_display_mode?: string;
          home_holdings_sort_mode?: string;
          home_holdings_sort_column?: string;
          home_holdings_sort_ascending?: boolean;
          active_account_id?: number;
          show_taiwan_weighted_index?: boolean;
          show_taiwan_portfolio_chart?: boolean;
          home_history_chart_expanded?: boolean;
          detail_history_chart_expanded?: boolean;
          margin_feature_enabled?: boolean;
          margin_day_count?: number;
          default_margin_annual_rate?: number;
          default_short_borrow_annual_rate?: number;
          last_update_highlights_version?: string | null;
          dividend_info_cache?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      holdings_order: {
        Row: {
          user_id: string;
          unrealized_order: Json;
          realized_order: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          unrealized_order?: Json;
          realized_order?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          unrealized_order?: Json;
          realized_order?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stocks: {
        Row: {
          market: string;
          code: string;
          name: string;
          exchange: string;
          industry: string;
          stock_type: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          market?: string;
          code: string;
          name?: string;
          exchange?: string;
          industry?: string;
          stock_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          market?: string;
          code?: string;
          name?: string;
          exchange?: string;
          industry?: string;
          stock_type?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_history_prices: {
        Row: {
          market: string;
          stock_code: string;
          date: string;
          price: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          market?: string;
          stock_code: string;
          date: string;
          price: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          market?: string;
          stock_code?: string;
          date?: string;
          price?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];
