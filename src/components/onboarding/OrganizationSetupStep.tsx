'use client';

import React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { OrganizationSetupSchema } from '@/lib/types/onboarding';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface OrganizationSetupStepProps {
  onNext: (data: any) => void;
}

export function OrganizationSetupStep({ onNext }: OrganizationSetupStepProps) {
  const form = useForm({
    resolver: zodResolver(OrganizationSetupSchema),
    defaultValues: {
      organizationName: '',
      industry: '',
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Let's Set Up Your Organization</CardTitle>
        <CardDescription>
          Tell us about your organization so we can tailor the compliance experience.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onNext)} className="space-y-6">
            <FormField
              control={form.control}
              name="organizationName"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Organization Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Acme Corp"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The legal name of your organization.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="industry"
              render={({ field }: any) => (
                <FormItem>
                  <FormLabel>Industry (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., FinTech, Healthcare"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full">
              Continue
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
