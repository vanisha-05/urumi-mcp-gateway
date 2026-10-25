export interface Product {
  id: number | string;
  name: string;
  price: number;
  regular_price?: string;
  description: string;
  short_description?: string;
  category: string;
  image: string;
  stock_status: 'instock' | 'outofstock' | 'onbackorder';
  features: string[];
  tag?: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface Order {
  id: string;
  items: CartItem[];
  total: number;
  status: 'processing' | 'completed' | 'pending';
  date: string;
  customer: {
    name: string;
    email: string;
    address: string;
  };
}
