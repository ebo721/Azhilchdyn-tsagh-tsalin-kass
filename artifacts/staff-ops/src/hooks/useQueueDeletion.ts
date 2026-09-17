import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getListDeletionRequestsQueryKey, useCreateDeletionRequest, useGetAuthSession } from '@workspace/api-client-react';

export function useQueueDeletion() {
  const mutation = useCreateDeletionRequest();
  const session = useGetAuthSession();
  const qc = useQueryClient();
  const [directPending, setDirectPending] = useState(false);
  const [directError, setDirectError] = useState(false);
  const request = async (targetPath: string, label: string) => {
    if (session.data?.role === 'admin') {
      setDirectPending(true);
      setDirectError(false);
      try {
        const response = await fetch(`/api${targetPath}`, { method: 'DELETE', credentials: 'include' });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || 'Устгах боломжгүй байна.');
        }
        await qc.invalidateQueries();
        window.alert(`${label} устгагдлаа.`);
      } catch (error) {
        setDirectError(true);
        window.alert(error instanceof Error ? error.message : 'Устгах боломжгүй байна.');
      } finally {
        setDirectPending(false);
      }
      return;
    }
    mutation.mutate({ data: { targetPath, label } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListDeletionRequestsQueryKey() });
        window.alert('Устгах хүсэлт админы зөвшөөрөл хүлээж байна.');
      },
    });
  };
  return { request, isAdmin: session.data?.role === 'admin', isPending: mutation.isPending || directPending, isError: mutation.isError || directError };
}