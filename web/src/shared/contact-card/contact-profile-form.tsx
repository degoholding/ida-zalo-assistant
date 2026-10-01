import { useState, type FormEvent } from 'react'

import { useCompanyLookup } from '@/shared/lookups/use-lookups'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'
import { Textarea } from '@/shared/ui/textarea'
import { CONTACT_KIND_OPTIONS, CONTACT_ROLE_OPTIONS, KIND_MODE_AUTO, type Contact } from './contact-constants'
import { getKindLabel, splitTags } from './format-contact'
import { useUpdateContact } from './use-contact-card'

/** Biểu mẫu gọn ở cột phải màn Hội thoại: loại (tự động / chỉnh tay), vai trò, công ty, thẻ, ghi chú. */
export function ContactProfileForm({ contact }: { contact: Contact }) {
  const companies = useCompanyLookup(true)
  const update = useUpdateContact(contact.id)
  const [kindMode, setKindMode] = useState(contact.kind_mode)
  const [role, setRole] = useState(String(contact.role))
  const [companyId, setCompanyId] = useState(String(contact.company_id))
  const [tags, setTags] = useState(contact.tags.join(', '))
  const [note, setNote] = useState(contact.note ?? '')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    update.mutate({ kind_mode: kindMode, role: Number(role), company_id: Number(companyId), tags: splitTags(tags), note })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>Loại</Label>
        <Select value={kindMode} onValueChange={setKindMode}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={KIND_MODE_AUTO}>Theo nhóm{contact.kind_mode === KIND_MODE_AUTO ? `: ${getKindLabel(contact.kind)}` : ''}</SelectItem>
            {CONTACT_KIND_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Vai trò với bot</Label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CONTACT_ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={String(option.value)}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Công ty</Label>
        <Select value={companyId} onValueChange={setCompanyId}>
          <SelectTrigger className="w-full"><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {(companies.data ?? []).map((company) => (
              <SelectItem key={company.id} value={String(company.id)}>{company.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-tags">Thẻ</Label>
        <Input id="contact-tags" value={tags} onChange={(event) => setTags(event.target.value)} placeholder="vip, đại lý, miền Nam…" maxLength={600} />
        <span className="text-xs text-muted-foreground">Cách nhau bằng dấu phẩy</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="contact-note">Ghi chú</Label>
        <Textarea id="contact-note" value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={5000}
          placeholder="Số điện thoại, nhu cầu, lưu ý khi chăm sóc…" />
      </div>
      <Button type="submit" disabled={update.isPending}>Lưu hồ sơ</Button>
    </form>
  )
}
