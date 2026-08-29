import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function ShowroomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const product = await prisma.lmsProduct.findUnique({ where: { id } });
  if (!product || !product.isActive) return notFound();

  const price = product.price ? Number(product.price) : null;
  const specs = (product.specs as Record<string, string>) ?? {};
  const features = product.features ?? [];
  const specEntries = Object.entries(specs);

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-xl mx-auto px-6 py-10">
        {product.imageUrl && (
          <div className="flex justify-center mb-8">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="h-56 w-auto object-contain rounded-2xl"
            />
          </div>
        )}

        <p className="text-sm text-gray-400 uppercase tracking-wide mb-1">{product.brand}</p>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{product.name}</h1>

        {price != null && (
          <p className="text-2xl font-semibold text-blue-600 mb-6">
            {'\u20B9'}{price.toLocaleString('en-IN')}
          </p>
        )}

        {product.uniqueFact && (
          <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 mb-6">
            <p className="text-sm font-medium text-blue-800">{product.uniqueFact}</p>
          </div>
        )}

        {specEntries.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Specifications</h2>
            <div className="bg-gray-50 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {specEntries.map(([key, val]) => (
                    <tr key={key}>
                      <td className="px-5 py-3 text-gray-500 font-medium w-2/5">{key}</td>
                      <td className="px-5 py-3 text-gray-900">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {features.length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-3">Features</h2>
            <ul className="space-y-2">
              {features.map((f, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-blue-600 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-12 text-center">
          <Link
            href="/products"
            className="text-xs text-gray-400 hover:text-gray-600 transition"
          >
            Back to App
          </Link>
        </div>
      </div>
    </div>
  );
}
