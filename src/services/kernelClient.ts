import axios from 'axios';

type KernelResult = {
  ok: boolean;
  status: string;
  output?: string;
  message?: string;
  orgId?: string;
  capabilityId?: string;
  provider?: string;
  model?: string;
  estimatedInputTokens?: number;
};

export async function executeHiltechKernelTask(text: string): Promise<KernelResult> {
  const baseUrl = process.env.COMPANY_KERNEL_URL;
  const secret = process.env.KERNEL_API_SECRET;

  if (!baseUrl) throw new Error('COMPANY_KERNEL_URL is not configured');
  if (!secret) throw new Error('KERNEL_API_SECRET is not configured');

  const response = await axios.post(
    `${baseUrl.replace(/\/$/, '')}/api/kernel/execute`,
    {
      text,
      tenantId: 'hiltech',
      sourceBot: 'hilabot'
    },
    {
      headers: {
        'x-kernel-secret': secret
      },
      timeout: 60000
    }
  );

  return response.data as KernelResult;
}