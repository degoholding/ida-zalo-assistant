import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import {
  MCP_USAGE_DAY_OPTIONS,
  MCP_USAGE_GROUP_OPTIONS,
  MCP_USAGE_SOURCE_OPTIONS,
  type McpUsageGroupBy,
  type McpUsageQuery,
  type McpUsageSource,
} from '../types/mcp-usage'

interface McpUsageFiltersProps {
  query: McpUsageQuery
  onChange: (patch: Partial<McpUsageQuery>) => void
}

/** Thanh lọc: khoảng ngày, gộp theo khóa / người, nguồn gọi. */
export function McpUsageFilters({ query, onChange }: McpUsageFiltersProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="space-y-1">
        <Label htmlFor="mcp-usage-days">Khoảng</Label>
        <Select value={String(query.days)} onValueChange={(days) => onChange({ days: Number(days) })}>
          <SelectTrigger id="mcp-usage-days" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MCP_USAGE_DAY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="mcp-usage-group">Gộp</Label>
        <Select value={query.group} onValueChange={(group) => onChange({ group: group as McpUsageGroupBy })}>
          <SelectTrigger id="mcp-usage-group" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MCP_USAGE_GROUP_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="mcp-usage-source">Nguồn</Label>
        <Select value={query.source} onValueChange={(source) => onChange({ source: source as McpUsageSource })}>
          <SelectTrigger id="mcp-usage-source" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MCP_USAGE_SOURCE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
