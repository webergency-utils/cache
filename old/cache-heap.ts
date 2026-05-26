import Heap from "@liqd-js/heap";
import sizeof from "./size";

const HEAP_INDEX_POINTERS = 16;

export default class CacheHeap<T,I=T> extends Heap<T,I>
{
    private heapSize: number = 0;
    public readonly itemMetaSize: number = 0;
    private readonly dataProperty?: string;

    constructor(
        compare: ( a: T, b: T ) => number,
        index: ( item: T ) => I,
        options: { itemMetaSize?: number, dataProperty?: string }
    )
    {
        super(compare, index);
        this.itemMetaSize = options.itemMetaSize || 0;
        this.dataProperty = options.dataProperty;
    }

    public push(item: T): this
    {
        this.heapSize += this.itemSize( item );
        return super.push(item);
    }

    public update(item: T): boolean
    {
        this.heapSize -= this.itemSize( this.data[this.data.indexOf(item)] );
        const updated = super.update(item);
        this.heapSize += this.itemSize( item );
        return updated;
    }

    public pop(): T | void
    {
        const item = super.pop();
        if ( item )
        {
            this.heapSize -= this.itemSize( item )
        }
        return item;
    }

    public delete(item: T): boolean
    {
        const deleted = super.delete(item);
        if ( deleted )
        {
            this.heapSize -= this.itemSize( item )
        }
        return deleted;
    }

    public memory(): number
    {
        return this.heapSize + this.size * ( this.itemMetaSize + HEAP_INDEX_POINTERS );
    }

    public randomTailItem(): T | void
    {
        if( this.data.length )
        {
            if( !this.sorted ){ this.sort_updated() }

            const tail_length = Math.ceil( Math.log2( this.data.length ));

            return this.data[this.data.length - 1 - Math.floor( Math.random() * tail_length )];
        }
    }

    public itemSize( item: T ): number
    {
        if ( typeof item !== 'object' || !this.dataProperty || (item && this.dataProperty && !(this.dataProperty in item)) )
        {
            return sizeof( item );
        }

        return sizeof( (item as any)[this.dataProperty] );
    }

    public totalItemSize( item: T ): number
    {
        return this.itemSize( item ) + this.itemMetaSize + HEAP_INDEX_POINTERS;
    }
}