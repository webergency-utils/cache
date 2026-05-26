import sizeof from "./size";
import CacheHeap from "./cache-heap";
import Queue from "@liqd-js/queue";

type WatchedValue = { id: string, seeks: Uint16Array };
type CachedValue<T> = WatchedValue & { data: T, size: number, stale?: Date };

export type CacheOptions = {
    maxItems?: number,
    maxSize?: number,
    cacheTime?: number,
    staleTime?: number
}

const CACHE_TO_WATCHED_RATIO = 0.9;

export default class Cache<T>
{
    private index = 0;
    private readonly cached: CacheHeap<CachedValue<T>, string>;
    private readonly watched: CacheHeap<WatchedValue, string>;
    private readonly stale?: Queue<CachedValue<T>> = undefined;
    private readonly cachedMaxItems: number = Infinity;
    private readonly cachedMaxSize?: number;
    private watchedMaxItems: number = 0;
    /** Number of seconds for which seek history is tracked */
    private readonly watchTime: number = 300;
    /** Number of buckets */
    private readonly precision: number = 10;
    /** Expiration time of a record in seconds */
    private readonly staleTime?: number;

    constructor(
        options: CacheOptions
    )
    {
        options.staleTime && ( this.stale = new Queue() ) && ( this.staleTime = options.staleTime );
        this.watchTime = options.cacheTime || this.watchTime;
        this.cachedMaxItems = options.maxItems || this.cachedMaxItems;
        this.cachedMaxSize = options.maxSize && options.maxSize * CACHE_TO_WATCHED_RATIO;

        this.cached = new CacheHeap(
            ( a, b ) => this.score(a) - this.score(b),
            i => i.id,
            {
                itemMetaSize: sizeof({ id: '6532518e7d7c2904492ef1c3', seeks: new Uint16Array( this.precision ), size: 0 }),
                dataProperty: 'data'
            });

        this.watched = new CacheHeap(
            ( a, b ) => this.score(a) - this.score(b),
            i => i.id,
            {
                itemMetaSize: sizeof({ id: '6532518e7d7c2904492ef1c3', seeks: new Uint16Array( this.precision ) }),
                dataProperty: 'data'
            });

        if ( options.maxSize )
        {
            this.watchedMaxItems = options.maxSize * 0.1 / this.watched.itemMetaSize;
        }

        setInterval(() =>
        {
            this.index = ( this.index + 1 ) % this.precision;
            for( let item of [...this.cached.values(), ...this.watched.values()] )
            {
                item.seeks[this.index] = 0;
            }
        }, this.watchTime );
    }

    public get( key: string ): T | void
    {
        this.removeStale();

        const cached = this.cached.get( key );
        if( cached )
        {
            this.incrementSeek( cached.seeks );
            return cached.data;
        }

        const watched = this.watched.get( key );
        if ( watched )
        {
            this.incrementSeek( watched.seeks );
        }
    }

    public set( key: string, value: T )
    {
        this.removeStale();

        const cached = this.cached.get( key );
        if ( cached )
        {
            this.updateCached( cached, value, true );
            this.cached.update( cached );
            return;
        }

        const watched = this.watched.get( key );
        if ( watched )
        {
            const cached: CachedValue<T> = this.initCached( watched, value, true );
            if ( this.loadToCache( cached ) )
            {
                this.watched.delete( watched );
            }
        }

        const newElem: CachedValue<T> = this.createCached(key, value, true);
        if ( !this.loadToCache( newElem ) )
        {
            const { data, ...watched } = newElem;
            this.addToWatched(watched);
        }
    }

    public invalidate( subject: string | ((key: string) => boolean) )
    {
        if ( typeof subject === 'string' )
        {
            const cached = this.cached.get( subject );
            if ( cached )
            {
                this.invalidateOne( subject );
            }
        }
        else
        {
            for( let key of this.cached.values() )
            {
                if ( subject( key.id ) )
                {
                    this.invalidateOne( key.id );
                }
            }
        }
    }

    public invalidateAll()
    {
        this.cached.clear();
        this.watched.clear();
        this.stale?.clear();
    }

    public delete( key: string )
    {
        const cached = this.cached.get( key );
        if ( cached )
        {
            this.cached.delete( cached );
            this.stale?.delete( cached );
            this.updateWatchMaxItems();
        }

        const watched = this.watched.get( key );
        if ( watched )
        {
            this.watched.delete( watched );
        }
    }

    public size()
    {
        return this.cached.size;
    }

    public memory()
    {
        return this.totalCachedSize() + this.totalWatchedSize();
    }

    public utilization()
    {
        if ( !this.cachedMaxSize && this.cachedMaxItems === Infinity )
        {
            return NaN;
        }

        return Math.max(
            this.cachedMaxSize ? this.memory() / this.cachedMaxSize / CACHE_TO_WATCHED_RATIO : 0,
            this.cachedMaxItems !== Infinity ? this.cached.size / this.cachedMaxItems : 0
        );
    }

    protected score( value: WatchedValue | CachedValue<any> ): number
    {
        let score = 0;
        for ( let i = 0; i < this.precision; i++ )
        {
            score += value.seeks[(this.precision + this.index - i) % this.precision] * (1 << i);
        }
        return score;
    }

    private invalidateOne( key: string )
    {
        const cached = this.cached.get( key );
        if ( cached )
        {
            this.cached.delete( cached );
            this.stale?.delete( cached );
            this.addToWatched({ id: cached.id, seeks: cached.seeks });
            this.updateWatchMaxItems();
        }
    }

    private totalCachedSize()
    {
        return this.cached.memory();
    }

    private totalWatchedSize()
    {
        return this.watched.memory();
    }

    private updateWatchMaxItems()
    {
        if ( this.cachedMaxSize ) { return }

        this.watchedMaxItems = this.cached.memory() * (1 - CACHE_TO_WATCHED_RATIO) / this.watched.itemMetaSize;
    }

    private createCached( key: string, data: T, incrementSeek: boolean = false ): CachedValue<T>
    {
        const elem = {
            id: key,
            size: sizeof( data ),
            seeks: this.initSeek(),
            stale: this.calculateStale(),
            data
        };

        incrementSeek && this.incrementSeek( elem.seeks );

        return elem;
    }

    private initCached( watched: WatchedValue, element: T, incrementSeek: boolean = false)
    {
        const cached: CachedValue<T> = { ...watched, size: sizeof( element ), stale: this.calculateStale(), data: element };
        incrementSeek && this.incrementSeek( cached.seeks );
        return cached;
    }

    private updateCached( cached: CachedValue<T>, element: T, incrementSeek: boolean = false)
    {
        cached.data = element;
        cached.size = sizeof( element );
        cached.stale = this.calculateStale();
        incrementSeek && this.incrementSeek( cached.seeks );

        if ( this.stale )
        {
            this.stale.delete( cached );
            this.stale.push( cached );
        }

        this.updateWatchMaxItems();
    }

    private calculateStale()
    {
        return this.staleTime
            ? new Date( Date.now() + (this.staleTime || 10 * 365 * 24 * 60 * 60) * 1000 )
            : undefined;
    }

    private loadToCache( element: CachedValue<T> )
    {
        if ( this.hasSpace( element ) )
        {
            this.cached.push( element );
            this.stale?.push( element );

            this.updateWatchMaxItems();

            return true;
        }

        const worst = this.cached.top();
        if ( worst && this.score( worst ) < this.score( element ) )
        {
            this.cached.delete( worst );
            this.cached.push( element );
            this.stale?.delete( worst );
            this.stale?.push( element );

            this.updateWatchMaxItems();

            return true;
        }

        return false;
    }

    private addToWatched( element: T | WatchedValue )
    {
        if ( this.watched.size < this.watchedMaxItems )
        {
            this.watched.push( element as WatchedValue );
            return true;
        }

        const worst = this.watched.randomTailItem();
        if ( worst && this.score( worst ) < this.score( element as WatchedValue ) )
        {
            this.watched.delete( worst );
            this.watched.push( element as WatchedValue );
            return true;
        }

        return false;
    }

    private hasSpace( element: CachedValue<T> )
    {
        return this.cached.size < this.cachedMaxItems
            && (
                !this.cachedMaxSize
                || this.totalCachedSize() + this.cached.totalItemSize( element ) <= this.cachedMaxSize
            );
    }

    private removeStale()
    {
        if ( !this.stale )
        {
            return;
        }

        let stale = this.stale.top();
        while( stale && stale.stale! < new Date() )
        {
            this.stale.pop();

            this.cached.delete( stale );

            this.addToWatched({ id: stale.id, seeks: this.initSeek() });

            stale = this.stale.top();
        }
    }

    private initSeek()
    {
        const seek = new Uint16Array( this.precision );

        for ( let i = 0; i < this.precision; i++ )
        {
            seek[i] = 0;
        }

        return seek;
    }

    private incrementSeek( seek: Uint16Array )
    {
        if( seek[this.index] === 0xFFFF )
        {
            return;
        }

        seek[this.index]++;
    }
}