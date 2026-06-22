"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PolicyType } from "@prisma/client";
import { api } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Wand2, Save, FileText, CheckCircle2 } from "lucide-react";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

export default function NewPolicyPage() {
  const router = useRouter();
  
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [policyType, setPolicyType] = useState<PolicyType>("PRIVACY_POLICY");
  const [context, setContext] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);

  const createPolicy = api.policy.create.useMutation({
    onSuccess: () => {
      toast.success("Policy saved successfully!");
      router.push("/dashboard/policies");
    },
    onError: (err: any) => {
      toast.error(`Failed to save policy: ${err.message}`);
    }
  });

  const generateMutation = api.policy.triggerAIGeneration.useMutation({
    onSuccess: (data: any) => {
      setJobId(data.jobId);
    },
    onError: (err: any) => {
      toast.error(`AI Generation failed: ${err.message}`);
      setStep(1);
    }
  });

  const { data: jobStatus, isFetching } = api.policy.getGenerationStatus.useQuery(
    { jobId: jobId! },
    {
      enabled: !!jobId,
      refetchInterval: (data: any) => {
        if (!data || data.state?.status === "active" || data.state?.status === "not_found" || data.status === "active" || data.status === "not_found") {
          return 2000;
        }
        return false;
      }
    }
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none p-6 border rounded-lg min-h-[500px]",
      },
    },
  });

  useEffect(() => {
    if (jobStatus?.status === "completed" && jobStatus.result) {
      editor?.commands.setContent(jobStatus.result);
    } else if (jobStatus?.status === "failed") {
      toast.error(`Generation failed: ${jobStatus.error}`);
      setStep(1);
      setJobId(null);
    }
  }, [jobStatus, editor]);

  const handleGenerate = () => {
    if (context.length < 10) {
      toast.error("Please provide a bit more context (at least 10 characters).");
      return;
    }
    setStep(3);
    generateMutation.mutate({ policyType, context });
  };

  const handleSave = (isPublished: boolean) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const content = (editor?.storage as any)?.markdown?.getMarkdown() || editor?.getHTML() || "";
    if (!content) {
      toast.error("Policy content is empty!");
      return;
    }
    
    // Convert ENUM format to Title Case
    const title = policyType.split('_').map(word => word.charAt(0) + word.slice(1).toLowerCase()).join(' ');

    createPolicy.mutate({
      title,
      policyType,
      content,
      isPublished,
    });
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">AI Policy Wizard</h1>
        <p className="text-gray-500 mt-1">Generate DPDP compliant policies tailored to your organization.</p>
      </div>

      {step === 1 && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Step 1: Select Policy Type</h2>
          <div className="space-y-4">
            <select
              value={policyType}
              onChange={(e) => setPolicyType(e.target.value as PolicyType)}
              className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md border"
            >
              {Object.keys(PolicyType).map((type) => (
                <option key={type} value={type}>
                  {type.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setStep(2)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-medium"
              >
                Next Step
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Step 2: Organizational Context</h2>
          <p className="text-sm text-gray-500 mb-4">
            Briefly describe your data processing activities. For example: "We are an e-commerce platform that collects user names, addresses, and payment info."
          </p>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={5}
            className="w-full border-gray-300 rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-3"
            placeholder="Describe your context here..."
          />
          <div className="flex justify-between mt-6">
            <button
              onClick={() => setStep(1)}
              className="text-gray-600 bg-gray-100 px-4 py-2 rounded-md hover:bg-gray-200 font-medium"
            >
              Back
            </button>
            <button
              onClick={handleGenerate}
              className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-medium flex items-center"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              Generate Policy
            </button>
          </div>
        </div>
      )}

      {step === 3 && !jobStatus?.result && (
        <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-200 text-center animate-in fade-in">
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-medium text-gray-900">Drafting Policy...</h2>
          <p className="text-gray-500 mt-2">Our AI is analyzing the DPDP Act 2023 and drafting your policy based on your context. This typically takes 30-60 seconds.</p>
        </div>
      )}

      {step === 3 && jobStatus?.status === "completed" && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8">
          <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <div className="flex items-center text-green-600">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              <span className="font-medium">Policy Generated Successfully</span>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => handleSave(false)}
                disabled={createPolicy.isPending}
                className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={createPolicy.isPending}
                className="flex items-center px-4 py-2 bg-indigo-600 rounded-md text-white hover:bg-indigo-700"
              >
                <FileText className="w-4 h-4 mr-2" />
                Publish Policy
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm">
            <EditorContent editor={editor} />
          </div>
        </div>
      )}
    </div>
  );
}
