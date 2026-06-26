'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, Plus } from 'lucide-react';
import { api } from '@/hooks/trpc';
import { toast } from 'sonner';

interface TeamMember {
  email: string;
  role: 'ADMIN' | 'COMPLIANCE_MANAGER' | 'VIEWER';
}

interface TeamSetupStepProps {
  onNext: (data: any) => void;
  onBack: () => void;
}

export function TeamSetupStep({ onNext, onBack }: TeamSetupStepProps) {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'COMPLIANCE_MANAGER'>('COMPLIANCE_MANAGER');
  const [isLoading, setIsLoading] = useState(false);
  const inviteTeamMembersMutation = api.onboarding.inviteTeamMembers.useMutation();

  const handleAddMember = () => {
    if (!newEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }

    if (teamMembers.some((m) => m.email === newEmail)) {
      toast.error('This email is already added');
      return;
    }

    setTeamMembers([...teamMembers, { email: newEmail, role: newRole }]);
    setNewEmail('');
  };

  const handleRemoveMember = (email: string) => {
    setTeamMembers((prev) => prev.filter((m) => m.email !== email));
  };

  const handleNext = async () => {
    setIsLoading(true);
    try {
      if (teamMembers.length > 0) {
        await inviteTeamMembersMutation.mutateAsync({
          teamMembers,
        });
        toast.success(`${teamMembers.length} team member(s) invited!`);
      }
      onNext({ teamMembers });
    } catch (error) {
      toast.error('Failed to invite team members');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite your team</CardTitle>
        <CardDescription>
          Add the people who will help manage proof, policies, and reviews. You can skip this for now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Add Member Form */}
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="team@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as any)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPLIANCE_MANAGER">Compliance Manager</SelectItem>
                <SelectItem value="VIEWER">Viewer</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleAddMember} variant="outline" size="icon">
              <Plus className="w-4 h-4" />
            </Button>
          </div>

          {/* Team Members List */}
          {teamMembers.length > 0 && (
            <div className="space-y-2">
              {teamMembers.map((member, index) => (
                <motion.div
                  key={member.email}
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800"
                >
                  <div>
                    <p className="text-sm font-medium">{member.email}</p>
                    <p className="text-xs text-stone-500">{member.role.replace(/_/g, ' ')}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveMember(member.email)}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </motion.div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 mt-8">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isLoading}
            className="flex-1"
          >
            Back
          </Button>
          <Button onClick={handleNext} disabled={isLoading} className="flex-1">
            {isLoading ? 'Inviting...' : 'Continue'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
